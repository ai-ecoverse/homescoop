#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../npm-parity.mjs';

export const REPO_URL = 'https://github.com/ai-ecoverse/homescoop';
export const PUBLISH_WORKFLOWS = ['.github/workflows/ladder-build.yml'];
export const MAIN = 'refs/heads/main';
const SLSA = 'https://slsa.dev/provenance/v1';

export const PREBUILT = [
  {
    re: /\$\{([A-Za-z0-9_]*(?:STAGE|STAGED|WHEEL|WHL|PREBUILT|RELEASE_URL|ARTIFACT)[A-Za-z0-9_]*):?[-=?]/g,
    why: (m) => `env-overridable prebuilt input ${m[1]}`,
  },
  { re: /\$\{?ROOT\}?\/\.\./g, why: () => 'a tree outside the repo ($ROOT/..)' },
  { re: /ai-ecoverse\/homescoop\/releases\/download/g, why: () => "a download of homescoop's own release artifacts" },
];

export function parseRecipe(text) {
  const out = {};
  let section = null;
  const unquote = (s) => (/^(["']).*\1$/.test(s) ? s.slice(1, -1) : s);
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = raw.match(/^( *)([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!m) continue;
    const [, indent, key, rest] = m;
    const value = unquote(rest.replace(/\s+#.*$/, ''));
    if (!indent.length) {
      if (rest === '') {
        out[key] = {};
        section = key;
      } else {
        out[key] = value;
        section = null;
      }
    } else if (section && indent.length === 2 && rest !== '') {
      out[section][key] = value;
    }
  }
  return out;
}

const stripComments = (text) => String(text).split('\n').map((l) => (/^\s*#/.test(l) ? '' : l));

export const MAX_DEPTH = 8;

export function resolveRef(ref, from, pkg) {
  const dir = from.split('/').slice(0, -1).join('/');
  const norm = (path) => {
    const out = [];
    for (const part of path.split('/')) {
      if (part === '..') out.pop();
      else if (part && part !== '.') out.push(part);
    }
    return out.join('/');
  };
  let m;
  if ((m = ref.match(/(?:^|[/"'(])(scripts\/[A-Za-z0-9_.\/-]+\.(?:sh|bash))$/)) && /\$\{?(?:HOMESCOOP_)?ROOT\}?\/scripts\/|^\.\.\/\.\.\/scripts\/|pwd\)\/scripts\/|^\(?scripts\//.test(ref)) {
    return { paths: [norm(m[1])], explicit: true };
  }
  if ((m = ref.match(/(?:^|[/"'(])(packages\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+\.(?:sh|bash))$/))) return { paths: [norm(m[1])], explicit: true };
  if ((m = ref.match(/\$\{?HOMESCOOP_PKG\}?\/([A-Za-z0-9_.\/-]+\.(?:sh|bash))$/))) return { paths: [norm(`packages/${pkg}/${m[1]}`)], explicit: true };
  if ((m = ref.match(/\$\(\s*dirname\s+"?\$(?:0|\{BASH_SOURCE(?:\[0\])?\})"?\s*\)"?\/([A-Za-z0-9_.\/-]+\.(?:sh|bash))$/))) {
    return { paths: [norm(`${dir}/${m[1]}`)], explicit: true };
  }
  const tail = ref.replace(/^.*\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\//, '').replace(/^.*\)\//, '');
  if (tail.startsWith('/') || !/^[A-Za-z0-9_.\/-]+\.(?:sh|bash)$/.test(tail)) return { paths: [], explicit: false };
  return { paths: [...new Set([norm(`packages/${pkg}/${tail}`), norm(`${dir}/${tail}`)])], explicit: false };
}

export function buildFiles(readAt, commit, pkg) {
  const files = [];
  const problems = [];
  const cache = new Map();
  const read = (path) => {
    if (!cache.has(path)) cache.set(path, readAt(commit, path));
    return cache.get(path);
  };
  const start = `packages/${pkg}/build.sh`;
  if (read(start) == null) return null;
  const queue = [{ path: start, depth: 0 }];
  const seen = new Set([start]);
  while (queue.length) {
    const { path, depth } = queue.shift();
    const text = read(path);
    files.push({ path, text });
    const body = stripComments(text).join('\n');
    const loops = loopWords(body);
    const owned = /^packages\/[^/]+\//.test(path);
    const vars = owned ? pathVars(body) : new Map();
    for (const m of body.matchAll(/[^\s;|&<>=`]*\.(?:sh|bash)\b/g)) {
      const raw = m[0].replace(/["']+$/, '');
      const substituted = substituteVars(raw, vars);
      const refs = expandLoopVars(substituted, loops);
      if (!refs) {
        problems.push(`${path} runs ${raw}, whose package name is a variable this rule can't resolve (only a literal name, or a for-loop over literal names, can be followed)`);
        continue;
      }
      for (const ref of refs) {
        const owner = path.match(/^packages\/([^/]+)\//)?.[1] || pkg;
        const resolved = resolveRef(ref, path, owner);
        const { paths } = resolved;
        const explicit = resolved.explicit && (substituted === raw || resolveRef(raw, path, owner).explicit);
        const found = paths.find((p) => p === path || seen.has(p) || read(p) != null);
        if (owned && found === path && !resolved.explicit && /\$\{?[A-Za-z_]|\)\//.test(ref)) {
          problems.push(`${path} runs ${ref}, a script behind a variable this rule can't resolve (it would read as ${path} itself)`);
          continue;
        }
        if (!found) {
          if (explicit) problems.push(`${path} runs ${ref}, which isn't in the tree`);
          continue;
        }
        if (seen.has(found)) continue;
        if (depth + 1 > MAX_DEPTH) {
          problems.push(`${path} runs ${found} past the depth cap of ${MAX_DEPTH}`);
          continue;
        }
        seen.add(found);
        queue.push({ path: found, depth: depth + 1 });
      }
    }
  }
  return { files, problems };
}

export function pathVars(body) {
  const seen = new Map();
  for (const m of String(body).matchAll(/^\s*(?:export\s+|local\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)=("[^"\n]*"|'[^'\n]*'|[^\s;&|]*)\s*(?:$|;)/gm)) {
    seen.set(m[1], seen.has(m[1]) ? null : m[2].replace(/^(["'])(.*)\1$/, '$2'));
  }
  return new Map([...seen].filter(([, v]) => v !== null && /[$/]/.test(v) && !/\$\(|`/.test(v)));
}

export function substituteVars(ref, vars) {
  let out = ref;
  for (let round = 0; round < 4; round++) {
    const next = out.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (all, name) => (vars.has(name) ? vars.get(name) : all));
    if (next === out) break;
    out = next;
  }
  return out;
}

export function loopWords(body) {
  const out = new Map();
  const text = String(body);
  for (const m of text.matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]*?)\s*(?:;|\n)\s*do\b/g)) {
    const words = m[2].trim().split(/\s+/).map((w) => w.replace(/^(["'])(.*)\1$/, '$2'));
    if (out.get(m[1]) === null || !words.length || !words.every((w) => /^[A-Za-z0-9_.+-]+$/.test(w))) out.set(m[1], null);
    else out.set(m[1], [...new Set([...(out.get(m[1]) || []), ...words])]);
  }
  for (const name of out.keys()) {
    if (new RegExp(`(?:^|[\\s;&|(])(?:export\\s+|local\\s+|declare\\s+[-a-z]*\\s*|readonly\\s+)?${name}\\+?=|\\bread\\s+(?:-[a-z]+\\s+)*(?:[A-Za-z_][A-Za-z0-9_]*\\s+)*${name}\\b`, 'm').test(text)) out.set(name, null);
  }
  return out;
}

export function expandLoopVars(ref, loops) {
  let refs = [ref];
  for (const [name, words] of loops) {
    const re = new RegExp(`\\$(?:\\{${name}\\}|${name}(?![A-Za-z0-9_]))`, 'g');
    if (words === null) {
      if (refs.some((r) => re.test(r))) return null;
      continue;
    }
    refs = refs.flatMap((r) => (re.test(r) ? words.map((w) => r.replace(re, w)) : [r]));
  }
  if (refs.some((r) => /(?:^|\/)packages\/[^/]*\$/.test(r))) return null;
  return refs;
}

export function prebuiltInputs(files) {
  const hits = [];
  for (const { path, text } of files) {
    stripComments(text).forEach((line, i) => {
      for (const { re, why } of PREBUILT) {
        for (const m of line.matchAll(re)) hits.push({ path, line: i + 1, why: why(m) });
      }
    });
  }
  return hits;
}

export function fetchesPinnedSource(files, sha) {
  const arg = (a) => a.replace(/^["']|["']$/g, '');
  return files.some(({ text }) => {
    let reassigned = false;
    const lines = stripComments(text).join('\n').replace(/\\\n\s*/g, ' ').split('\n');
    for (const line of lines) {
      for (const m of line.matchAll(/\bhomescoop_fetch\s+("[^"]*"|'[^']*'|\S+)\s+("[^"]*"|'[^']*'|\S+)/g)) {
        const v = arg(m[2]);
        if (!reassigned && /^\$\{?(?:SRC_SHA|SHA)\}?$/.test(v)) return true;
        if (/^[0-9a-f]{64}$/.test(sha || '') && v === sha) return true;
      }
      if (/(?:^|[;&|]\s*|\s)(?:export\s+|local\s+|declare\s+[-a-z]*\s*)?(?:SRC_SHA|SHA)=/.test(line)) reassigned = true;
    }
    return false;
  });
}

const integrityHex = (integrity) => {
  const m = String(integrity || '').match(/^sha512-(.+)$/);
  return m ? Buffer.from(m[1], 'base64').toString('hex') : '';
};

export function checkProvenance(doc, { npm, version, integrity }) {
  if (!doc) return { ok: false, reason: 'no npm provenance attestation' };
  const slsa = (doc.attestations || []).find((a) => a?.predicateType === SLSA);
  if (!slsa) return { ok: false, reason: 'no SLSA provenance among its attestations' };
  let statement;
  try {
    statement = JSON.parse(Buffer.from(slsa.bundle.dsseEnvelope.payload, 'base64').toString('utf8'));
  } catch {
    return { ok: false, reason: 'an unreadable SLSA provenance statement' };
  }
  const subject = `pkg:npm/${npm.replace(/^@/, '%40')}@${version}`;
  const want = integrityHex(integrity);
  const subj = (statement.subject || []).find((s) => s?.name === subject);
  if (!subj) return { ok: false, reason: `provenance for another subject than ${subject}` };
  if (!want || subj.digest?.sha512 !== want) return { ok: false, reason: "provenance for other bytes than the published tarball's" };
  const def = statement.predicate?.buildDefinition || {};
  const wf = def.externalParameters?.workflow || {};
  if (wf.repository !== REPO_URL) return { ok: false, reason: `provenance from ${wf.repository || 'no repository'}, not ${REPO_URL}` };
  if (!PUBLISH_WORKFLOWS.includes(wf.path)) return { ok: false, reason: `provenance from ${wf.path || 'no workflow'}, not ${PUBLISH_WORKFLOWS.join(' or ')}` };
  if (wf.ref !== MAIN) return { ok: false, reason: `provenance from ${wf.ref || 'no ref'}, not ${MAIN}` };
  const dep = (def.resolvedDependencies || []).find((d) => String(d?.uri || '').startsWith(`git+${REPO_URL}@`));
  const commit = dep?.digest?.gitCommit;
  if (!/^[0-9a-f]{40}$/.test(commit || '')) return { ok: false, reason: 'provenance names no homescoop commit' };
  return { ok: true, reason: '', commit, run: statement.predicate?.runDetails?.metadata?.invocationId };
}

export function sourceRule({ pkg, commit, readAt, recipe, label }) {
  const reasons = [];
  const source = recipe.source && typeof recipe.source === 'object' ? recipe.source : {};
  const sha = source.sha256 || '';
  const inTree = Object.hasOwn(source, 'in-tree') ? String(source['in-tree']).trim() : null;
  const build = buildFiles(readAt, commit, pkg);
  let prebuilt = [];
  if (!build) {
    reasons.push(`${label}'s tree has no packages/${pkg}/build.sh`);
  } else {
    prebuilt = prebuiltInputs(build.files);
    if (prebuilt.length) {
      const lead = label.startsWith('root ') ? 'root staged a prebuilt artifact' : `${label} can stage a prebuilt artifact`;
      reasons.push(`${lead}: ${label}'s build can take ${prebuilt.map((h) => `${h.why} (${h.path}:${h.line})`).join(', ')}`);
    }
    if (build.problems.length) reasons.push(`${label}'s build can't be read in full: ${build.problems.join(', ')}`);
  }
  if (inTree !== null) {
    reasons.push(...inTreeReasons({ pkg, commit, readAt, source, paths: inTree, files: build ? build.files : [], label }));
    return { reasons, sha: '', inTree: inTree.split(/\s+/).filter(Boolean), files: build ? build.files : null, prebuilt };
  }
  if (build) reasons.push(...pinnedFetchReasons({ pkg, commit, readAt, files: build.files, sha, label }));
  if (!/^[0-9a-f]{64}$/.test(sha)) reasons.push(`${label}'s recipe pins no source sha256 (${sha || 'none'})`);
  return { reasons, sha, inTree: null, files: build ? build.files : null, prebuilt };
}

export function pinnedFetchReasons({ pkg, commit, readAt, files, sha, label }) {
  const reasons = [];
  const ownerOf = (path) => path.match(/^packages\/([^/]+)\//)?.[1] || null;
  const shared = files.filter((f) => ownerOf(f.path) === null);
  const of = (owner) => [...files.filter((f) => ownerOf(f.path) === owner), ...shared];
  const others = [...new Set(files.map((f) => ownerOf(f.path)).filter((o) => o && o !== pkg))].sort();
  let ok = fetchesPinnedSource(of(pkg), sha);
  for (const other of others) {
    const text = readAt(commit, `packages/${other}/recipe.yaml`);
    const r = text == null ? null : parseRecipe(text);
    const otherSha = r?.source && typeof r.source === 'object' ? r.source.sha256 || '' : '';
    if (!/^[0-9a-f]{64}$/.test(otherSha)) {
      reasons.push(`${label}'s build runs packages/${other}/, whose recipe pins no source sha256 (${text == null ? 'no recipe.yaml' : otherSha || 'none'})`);
      continue;
    }
    const fetched = fetchesPinnedSource(of(other), otherSha);
    if (!fetched) reasons.push(`${label}'s build runs packages/${other}/, which never fetches its recipe's pinned source (${otherSha})`);
    else if (otherSha === sha) ok = true;
  }
  if (!ok) reasons.push(`${label}'s build never fetches the pinned source (no homescoop_fetch of $SRC_SHA, $SHA or ${sha || 'source.sha256'})`);
  return reasons;
}

export const INSTALLS = [
  { re: /\b(?:pip3?|python3?\s+-m\s+pip|uv\s+pip)\s+install\b/g, why: 'a pip install', pinned: /--require-hashes\b/ },
  { re: /\bnpm\s+(?:install|i|add)\b|\bnpx\s|\b(?:pnpm|yarn)\s+(?:add|install|dlx)\b|\bpnpx\s/g, why: 'an npm/pnpm/yarn install', pinned: /--frozen-lockfile\b|--immutable\b/ },
  { re: /\bcargo\s+(?:install|fetch|build|update|vendor)\b/g, why: 'a cargo download', pinned: /--locked\b|--frozen\b|--offline\b/ },
  { re: /\bgo\s+(?:install|get)\b|\bgo\s+mod\s+download\b/g, why: 'a go install', pinned: null },
  { re: /\brustup\s+(?:toolchain\s+install|target\s+add|component\s+add|install|update)\b|\brustup-init\b/g, why: 'a rustup toolchain download', pinned: null },
  { re: /\b(?:gem\s+install|apt-get\s+install|apt\s+install|brew\s+install|conda\s+install)\b/g, why: 'a system/package-manager install', pinned: null },
];

export function unpinnedFetches(files) {
  const hits = [];
  for (const { path, text } of files) {
    if (!path.startsWith('packages/')) continue;
    const lines = stripComments(text).join('\n').replace(/\\\n\s*/g, ' ').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/(?<![-\w/.$])(curl|wget)\s+\S|\bgit\s+(?:-C\s+\S+\s+)?(clone|fetch)\b/g)) {
        if (/command\s+-v\s*$/.test(line.slice(0, m.index))) continue;
        hits.push({ path, line: i + 1, why: m[1] ? `a ${m[1]} download` : `a git ${m[2]}` });
      }
      for (const { re, why, pinned } of INSTALLS) {
        for (const m of line.matchAll(re)) {
          if (pinned && pinned.test(line.slice(m.index))) continue;
          hits.push({ path, line: i + 1, why });
        }
      }
      for (const m of line.matchAll(/\bhomescoop_fetch\s+("[^"]*"|'[^']*'|\S+)\s+("[^"]*"|'[^']*'|\S+)/g)) {
        if (!/^[0-9a-f]{64}$/.test(m[2].replace(/^["']|["']$/g, ''))) hits.push({ path, line: i + 1, why: `a homescoop_fetch of ${m[1]} with no literal sha256` });
      }
    });
  }
  return hits;
}

export function inTreeReasons({ pkg, commit, readAt, source, paths, files, label }) {
  const reasons = [];
  if (source.url || source.sha256) reasons.push(`${label}'s recipe declares an in-tree source and also source.url/sha256`);
  const list = paths.split(/\s+/).filter(Boolean);
  if (!list.length) reasons.push(`${label}'s recipe declares an in-tree source with no paths`);
  for (const p of list) {
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.+\/-]*$/.test(p) || p.split('/').includes('..')) {
      reasons.push(`${label}'s in-tree source path ${p} isn't a plain path inside packages/${pkg}`);
    } else if (readAt(commit, `packages/${pkg}/${p}`) == null) {
      reasons.push(`${label}'s in-tree source packages/${pkg}/${p} isn't in its tree ${commit.length === 40 ? commit.slice(0, 12) : commit}`);
    }
  }
  const fetched = unpinnedFetches(files);
  if (fetched.length) reasons.push(`${label}'s in-tree build downloads what no pinned sha256 covers: ${fetched.map((h) => `${h.why} (${h.path}:${h.line})`).join(', ')}`);
  return reasons;
}

export async function trace({ pkg, npm, from, registry, readAt, reproduced = {} }) {
  const chain = [];
  const result = (attested, reason, root = null) => ({ package: pkg, npm, repack: true, chain, root, attested, reason });
  const packument = await registry.packument(npm);
  const seen = new Set();
  let version = String(from);
  for (;;) {
    if (seen.has(version)) return result(false, `repack chain loops back to ${version}`);
    seen.add(version);
    const meta = packument?.versions?.[version];
    if (!meta) return result(false, `${npm}@${version} isn't published`);
    const prov = checkProvenance(await registry.attestations(npm, version), { npm, version, integrity: meta.dist?.integrity });
    const commit = prov.ok ? prov.commit : meta.gitHead;
    const link = { version, integrity: meta.dist?.integrity || null, gitHead: meta.gitHead || null, commit: commit || null, provenance: prov.ok, run: prov.run || null };
    if (!prov.ok) link.provenanceReason = prov.reason;
    chain.push(link);
    if (!commit) return result(false, `${version} has no provenance (${prov.reason}) and no gitHead, so nothing says how it was made`);
    const recipeText = readAt(commit, `packages/${pkg}/recipe.yaml`);
    if (recipeText == null) return result(false, `${version}'s tree ${commit.slice(0, 12)} has no packages/${pkg}/recipe.yaml`);
    const recipe = parseRecipe(recipeText);
    const next = recipe.repack && typeof recipe.repack === 'object' ? recipe.repack.from : '';
    link.repackFrom = next || null;
    if (next) {
      if (!prov.ok) return result(false, `${version} is a repack of ${next} published without CI provenance (${prov.reason})`);
      version = String(next);
      continue;
    }
    const root = version;
    const rule = sourceRule({ pkg, commit, readAt, recipe, label: `root ${root}` });
    const reasons = [...rule.reasons];
    const { sha } = rule;
    if (rule.files) {
      link.buildFiles = rule.files.map((f) => f.path);
      link.prebuilt = rule.prebuilt;
    }
    link.sourceSha256 = sha || null;
    const rebuilt = reproduced[`${npm}@${root}`];
    const reproducedOk = Boolean(rebuilt) && rebuilt === meta.dist?.integrity;
    link.reproduced = reproducedOk;
    if (!prov.ok && !reproducedOk) {
      reasons.push(`root ${root} has no provenance from homescoop's ladder on main (${prov.reason}) and no reproducible rebuild on record${rebuilt ? ' (a rebuild gave other bytes)' : ''}`);
    }
    if (reasons.length) return result(false, reasons.join('; '), root);
    const what = rule.inTree ? 'its in-tree source' : 'the pinned source';
    return result(true, prov.ok ? `root ${root} built by ${prov.run || 'ladder-build on main'} from ${what}` : `root ${root} reproduced from ${what}`, root);
  }
}

export function gitReader(cwd = process.cwd()) {
  return (commit, path) => {
    try {
      execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd, stdio: 'ignore' });
    } catch {
      throw new Error(`commit ${commit} isn't in this clone`);
    }
    try {
      return execFileSync('git', ['show', `${commit}:${path}`], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
    } catch {
      return null;
    }
  };
}

export function githubReader(repo) {
  return (commit, path) => {
    try {
      return execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${repo}/contents/${path}?ref=${commit}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 << 20,
      });
    } catch (error) {
      if (/HTTP 404/.test(String(error.stderr || ''))) return null;
      throw new Error(`gh api ${path}@${commit}: ${String(error.stderr || error.message).trim()}`);
    }
  };
}

const enc = (npm) => npm.replace('/', '%2f');

export function npmRegistry(base = 'https://registry.npmjs.org') {
  const get = async (url) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        return await res.json();
      } catch (error) {
        if (attempt >= 4) throw error;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  };
  return {
    packument: (npm) => get(`${base}/${enc(npm)}`),
    attestations: (npm, version) => get(`${base}/-/npm/v1/attestations/${enc(npm)}@${version}`),
  };
}

export function fixtureRegistry(dir) {
  const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
  return {
    packument: async (npm) => read(join(dir, 'packument', `${enc(npm)}.json`)),
    attestations: async (npm, version) => read(join(dir, 'attestations', `${enc(npm)}@${version}.json`)),
  };
}

export function fixtureReader(dir) {
  return (commit, path) => {
    if (!existsSync(join(dir, 'tree', commit))) throw new Error(`commit ${commit} isn't in the fixtures`);
    const file = join(dir, 'tree', commit, path);
    if (!existsSync(file)) return null;
    return statSync(file).isDirectory() ? readdirSync(file).sort().join('\n') : readFileSync(file, 'utf8');
  };
}

export const KNOWN_INPUTS = fileURLToPath(new URL('./known-inputs.txt', import.meta.url));
export const MAX_INPUT_DEPTH = 8;
const NPM_SPEC = /^(@ai-ecoverse\/[a-z0-9][a-z0-9._-]*)@([0-9][0-9A-Za-z.+-]*)$/;
const DEP_KEYS = ['build', 'host', 'run', 'mamba', 'npm'];
const DOC_SINK = /\.(?:md|txt|json|xml|html?|pc|ya?ml|toml|cfg|conf|ini)["']?$/;
const OUR_NPM = /registry\.npmjs\.org\/@ai-ecoverse(?:\/|%2[fF])/;
const TARBALL = /registry\.npmjs\.org\/@ai-ecoverse(?:\/|%2[fF])([a-z0-9][a-z0-9._-]*)\/-\/([^\s"'<>()|;&]*?)\.tgz/g;
const NPM_CMD = /(?:^\s*|[;&|(]\s*|\$\(\s*|\b(?:then|do|else)\s+)(?:(?:env\s+(?:-\S+\s+)*)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*|command\s+|sudo\s+|exec\s+)*(?:npm\s+(?:pack|install|i|add|exec|ci)|pnpm\s+(?:add|install|i|dlx|exec)|yarn\s+(?:add|dlx)|npx|pnpx)\b(.*)$/;

export function parseKnownInputs(text) {
  const out = new Map();
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = line.match(/^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)@([0-9][0-9A-Za-z.+-]*) #(\d+) (\S.*)$/);
    if (!m) throw new Error(`known-inputs line ${i + 1} isn't "<@scope/name>@<version> #<issue> <reason>": ${line}`);
    const key = `${m[1]}@${m[2]}`;
    if (out.has(key)) throw new Error(`known-inputs line ${i + 1} repeats ${key}`);
    out.set(key, { npm: m[1], version: m[2], issue: m[3], reason: m[4] });
  });
  return out;
}

export function readKnownInputs(path = KNOWN_INPUTS) {
  return parseKnownInputs(readFileSync(path, 'utf8'));
}

function tarballInput(name, tail, where, resolve) {
  const versions = tail.startsWith(`${name}-`) ? resolve(tail.slice(name.length + 1)) : null;
  if (!versions) return { problem: `${where} fetches @ai-ecoverse/${name} as ${tail}.tgz, whose version this rule can't resolve` };
  return { inputs: versions.map((version) => ({ npm: `@ai-ecoverse/${name}`, version, via: where })) };
}

export function recipeInputs(text, recipeVersion = '') {
  const inputs = [];
  const problems = [];
  let top = null;
  let sub = null;
  const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, '$2');
  const spec = (s, where) => {
    const item = unquote(s);
    if (!item.startsWith('@ai-ecoverse/')) return;
    const m = item.match(NPM_SPEC);
    if (m) inputs.push({ npm: m[1], version: m[2], via: where });
    else problems.push(`${where} installs ${item}, which isn't pinned to an exact version`);
  };
  const literal = (v) => (/^[0-9][0-9A-Za-z.+-]*$/.test(v) ? [v] : null);
  String(text).split(/\r?\n/).forEach((raw, i) => {
    if (!raw.trim() || raw.trim().startsWith('#')) return;
    const indent = raw.match(/^ */)[0].length;
    const body = raw.trim().replace(/\s+#.*$/, '');
    const where = `recipe.yaml:${i + 1}`;
    if (indent === 0) {
      top = body.match(/^([A-Za-z0-9_-]+):/)?.[1] || null;
      sub = null;
    }
    if (top === 'dependencies' && indent === 2) {
      const m = body.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      sub = m ? m[1] : null;
      if (m && DEP_KEYS.includes(sub) && /^\[.*\]$/.test(m[2])) {
        m[2].slice(1, -1).split(',').filter((s) => s.trim()).forEach((s) => spec(s, where));
      }
    } else if (top === 'dependencies' && indent > 2 && DEP_KEYS.includes(sub) && body.startsWith('- ')) {
      spec(body.slice(2), where);
    }
    const url = body.match(/^(?:-\s+)?url:\s*(.*)$/);
    if (!url || !OUR_NPM.test(url[1])) return;
    const value = unquote(url[1]).replaceAll('{{version}}', recipeVersion);
    const hits = [...value.matchAll(TARBALL)];
    if (!hits.length) problems.push(`${where} points at homescoop's npm (${value}) with no tarball this rule can read`);
    for (const m of hits) {
      const r = tarballInput(m[1], m[2], where, literal);
      if (r.problem) problems.push(r.problem);
      else inputs.push(...r.inputs);
    }
  });
  return { inputs, problems };
}

function assignedValues(name, lines) {
  const out = [];
  const re = new RegExp(`(?:^|[\\s;&|(])(?:export\\s+|local\\s+|readonly\\s+|declare\\s+[-a-z]*\\s*)?${name}=("[^"]*"|'[^']*'|[^\\s;&|)]*)`);
  for (const line of lines) {
    const m = line.match(re);
    if (m) out.push(m[1].replace(/^(["'])(.*)\1$/, '$2'));
  }
  return out;
}

function shellLines(text) {
  const lines = stripComments(text).join('\n').replace(/\\\n\s*/g, ' ').split('\n');
  const out = [];
  let end = null;
  for (const line of lines) {
    if (end !== null) {
      if (line.trim() === end) end = null;
      out.push('');
      continue;
    }
    const doc = line.match(/^\s*(cat|tee)\b([^<|]*)<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\3([^|]*)$/);
    const sink = doc && (doc[1] === 'cat' ? (`${doc[2]} ${doc[5]}`.match(/>>?\s*(\S+)/) || [])[1] : doc[2].trim().split(/\s+/).pop());
    if (doc && sink && DOC_SINK.test(sink)) end = doc[4];
    out.push(line);
  }
  return out;
}

/**
 * Whether a helper's `${VAR:-default}` can't take effect, so its default isn't
 * a build input (homescoop#984). Every file that runs or sources the helper
 * must be a package build.sh (packages/<x>/build.sh) that sets VAR first, and
 * in each all of these hold:
 * - the assignment is at top level: column 0, outside if/case/loops/functions/
 *   subshells;
 * - it is `export VAR=<literal>`, or `VAR=<literal>` then a top-level `export VAR`;
 * - it comes before the first line that runs the helper, and nothing from it
 *   to the last such line reassigns or unsets VAR;
 * - the helper inherits it: no `env -i`, `env -u VAR` or `sudo` without
 *   -E/--preserve-env on a line that runs it.
 * Anything else: false, and both values count (fail closed).
 */
export function deadDefault(name, helperPath, all) {
  const helper = helperPath.split('/').pop();
  const stem = helper.replace(/\.(?:sh|bash)$/, '');
  const runs = (line) => line.includes(helper);
  const literal = String.raw`(?:"[^"$\`\\]*"|'[^']*'|[^\s;&|$\`"'()<>]+)`;
  const assign = new RegExp(`^(export\\s+)?${name}=${literal}\\s*$`);
  const exportOnly = new RegExp(`^export\\s+${name}\\s*$`);
  const touches = new RegExp(`(?:^|[\\s;&|(])(?:(?:export|local|readonly|declare|typeset)(?:\\s+-[a-zA-Z]+)*\\s+)?(?:[A-Za-z_][A-Za-z0-9_]*(?:=\\S*)?\\s+)*${name}(?:\\+?=|\\s|;|$)|\\bunset\\b[^;&|]*\\b${name}\\b|\\b(?:read|mapfile|readarray|printf\\s+-v)\\b[^;&|]*\\b${name}\\b`);
  const scrubs = new RegExp(`\\benv\\s+(?:\\S+\\s+)*?(?:-i\\b|--ignore-environment\\b|-\\s|-u\\s*${name}\\b|--unset[= ]${name}\\b)|\\bsudo\\b(?![^;&|]*\\s(?:-E\\b|--preserve-env\\b))`);
  const others = all.filter((f) => f.path !== helperPath);
  const callers = others.filter((f) => f.lines.some(runs));
  if (!callers.length) return false;
  // Every caller is a package build.sh, and none names the helper any other way
  // (a loop over "install-wasixcc", a variable holding its name).
  if (callers.some((f) => !/^packages\/[^/]+\/build\.sh$/.test(f.path))) return false;
  if (others.some((f) => f.lines.some((l) => l.includes(stem) && !runs(l)))) return false;
  const marks = new Map();
  for (const f of callers) {
    const { lines } = f;
    const calls = lines.map((l, i) => (runs(l) ? i : -1)).filter((i) => i >= 0);
    const first = calls[0];
    if (calls.some((i) => scrubs.test(lines[i]))) return false;
    const code = codeLines(lines);
    const track = blockTracker();
    let depth = 0;
    let at = -1;
    let exp = -1;
    for (let i = 0; i < first; i++) {
      const line = lines[i];
      if (at < 0 && depth === 0 && code[i]) {
        const m = line.match(assign);
        if (m) {
          at = i;
          if (m[1]) exp = i;
        }
      } else if (at >= 0 && exp < 0 && depth === 0 && code[i] && exportOnly.test(line)) {
        exp = i;
      }
      depth = track(line);
      if (depth < 0) return false;
    }
    if (at < 0 || exp < 0) return false;
    for (let i = at; i <= first; i++) if (!code[i]) return false;
    marks.set(f, new Set([at, exp]));
  }
  // Nothing else, in any file but the helper, sets, exports, unsets or reads VAR
  // (a function defined before the override and run after it, a sourced file).
  return !others.some((f) => f.lines.some((l, i) => touches.test(l) && !marks.get(f)?.has(i)));
}

/**
 * Which lines are shell code: false inside a heredoc body (any `<<WORD`, up to
 * its terminator) and inside quotes left open across lines.
 */
function codeLines(lines) {
  const out = [];
  let end = null;
  let quote = null;
  for (const line of lines) {
    if (end !== null) {
      out.push(false);
      if (line.replace(/^\t+/, '') === end) end = null;
      continue;
    }
    out.push(quote === null);
    let q = quote;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q === null) {
        if (c === '\\') i++;
        else if (c === "'" || c === '"') q = c;
      } else if (q === '"' && c === '\\') i++;
      else if (c === q) q = null;
    }
    quote = q;
    if (quote === null) {
      const doc = line.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, (m) => (/^['"]?[A-Za-z_][A-Za-z0-9_]*['"]?$/.test(m) ? m : '""')).match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1(?!<)/);
      if (doc && !/<<</.test(line)) end = doc[2];
    }
  }
  return out;
}

/**
 * Shell block nesting, line by line (comment-free lines): if/case/loops,
 * { } groups and function bodies, ( ) subshells. Quoted text doesn't count,
 * and inside a case the pattern parentheses don't either. An approximation
 * that errs towards "nested", which only ever keeps a default as an input.
 */
function blockTracker() {
  let depth = 0;
  let cases = 0;
  return (line) => {
    const t = line.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '""').trim();
    if (t) {
      const opens = (t.match(/(?:^|[;&|(]\s*|\b(?:then|do|else)\s+)(?:if|case|while|until|for|select)\b/g) || []).length;
      const closes = (t.match(/(?:^|[;&|]\s*)(?:fi|esac|done)\b/g) || []).length;
      cases += (t.match(/(?:^|[;&|(]\s*|\b(?:then|do|else)\s+)case\b/g) || []).length;
      const braces = (t.match(/(?:^|[\s)])\{(?=\s|$)/g) || []).length - (t.match(/(?:^|[\s;])\}(?=\s|;|$)/g) || []).length;
      const parens = cases > 0 ? 0 : (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
      cases -= (t.match(/(?:^|[;&|]\s*)esac\b/g) || []).length;
      if (cases < 0) cases = 0;
      depth += opens - closes + braces + parens;
    }
    return depth;
  };
}

export function buildFileInputs(files) {
  const inputs = [];
  const problems = [];
  const all = files.map(({ path, text }) => ({ path, lines: shellLines(text) }));
  const everywhere = all.flatMap((f) => f.lines);
  const resolver = (lines, path) => (expr) => {
    let parts = [''];
    const re = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?|([^$]+)/g;
    for (const m of expr.matchAll(re)) {
      if (m[2] !== undefined) {
        parts = parts.map((p) => p + m[2]);
        continue;
      }
      const values = new Set();
      for (const v of assignedValues(m[1], lines)) {
        const d = v.match(/^\$\{([A-Za-z_][A-Za-z0-9_]*):?-([^}$]*)\}$/);
        if (d) {
          if (!deadDefault(d[1], path, all)) values.add(d[2]);
          for (const o of assignedValues(d[1], everywhere)) values.add(o);
        } else values.add(v);
      }
      if (!values.size) return null;
      parts = parts.flatMap((p) => [...values].map((v) => p + v));
    }
    return parts.every((p) => /^[0-9][0-9A-Za-z.+-]*$/.test(p)) ? [...new Set(parts)] : null;
  };
  for (const { path, lines } of all) {
    const resolve = resolver(lines, path);
    lines.forEach((line, i) => {
      const where = `${path}:${i + 1}`;
      if (OUR_NPM.test(line)) {
        const hits = [...line.matchAll(TARBALL)];
        if (!hits.length) problems.push(`${where} points at homescoop's npm with no tarball this rule can read`);
        for (const m of hits) {
          const r = tarballInput(m[1], m[2], where, resolve);
          if (r.problem) problems.push(r.problem);
          else inputs.push(...r.inputs);
        }
      }
      const cmd = line.match(NPM_CMD);
      if (!cmd) return;
      for (const m of cmd[1].matchAll(/(?<![\w/.-])(@ai-ecoverse\/[A-Za-z0-9._${}-]+(?:@[^\s"'`;|&)]*)?)/g)) {
        const s = m[1].replace(/["']+$/, '');
        const pinned = s.match(NPM_SPEC);
        if (pinned) inputs.push({ npm: pinned[1], version: pinned[2], via: where });
        else problems.push(`${where} installs ${s}, which isn't pinned to an exact version`);
      }
    });
  }
  return { inputs, problems };
}

function memoRegistry(registry) {
  const packuments = new Map();
  const attestations = new Map();
  const once = (map, key, get) => {
    if (!map.has(key)) map.set(key, get());
    return map.get(key);
  };
  return {
    packument: (npm) => once(packuments, npm, () => registry.packument(npm)),
    attestations: (npm, version) => once(attestations, `${npm}@${version}`, () => registry.attestations(npm, version)),
  };
}

function memoReader(readAt) {
  const cache = new Map();
  return (commit, path) => {
    const key = `${commit}:${path}`;
    if (!cache.has(key)) cache.set(key, readAt(commit, path));
    return cache.get(key);
  };
}

function recipeDirs(meta, npm) {
  const dirs = [];
  const fromRepo = String(meta?.repository?.directory || '').match(/^packages\/([^/]+)(?:\/package)?\/?$/)?.[1];
  if (fromRepo) dirs.push(fromRepo);
  const bare = npm.replace(/^@ai-ecoverse\//, '');
  dirs.push(bare);
  if (bare.startsWith('wasm-')) dirs.push(bare.slice(5));
  return [...new Set(dirs)];
}

export function inputsAt({ readAt, commit, pkg, recipeText, recipe, files }) {
  const fromRecipe = recipeInputs(recipeText, recipe?.version || '');
  const fromBuild = buildFileInputs(files || []);
  const seen = new Set();
  const inputs = [...fromRecipe.inputs, ...fromBuild.inputs]
    .map((i) => ({ ...i, via: i.via.startsWith('recipe.yaml') ? `packages/${pkg}/${i.via}` : i.via }))
    .filter((i) => {
      const key = `${i.npm}@${i.version}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const problems = [...fromRecipe.problems.map((p) => `packages/${pkg}/${p}`), ...fromBuild.problems];
  return { inputs, problems, commit };
}

export function inputChecker({ registry, readAt, known = new Map(), reproduced = {} }) {
  const ctx = { registry: memoRegistry(registry), readAt: memoReader(readAt), known, reproduced, memo: new Map(), active: new Set(), cycles: 0 };
  const check = (npm, version, depth = 1) => checkInput(ctx, npm, version, depth);
  return { check, ctx };
}

async function checkInput(ctx, npm, version, depth) {
  const key = `${npm}@${version}`;
  if (ctx.memo.has(key)) return ctx.memo.get(key);
  if (ctx.active.has(key)) {
    ctx.cycles++;
    return { ok: false, known: [], reason: `${key} is an input of its own build` };
  }
  if (depth > MAX_INPUT_DEPTH) return { ok: false, known: [], reason: `${key} is past the input depth cap of ${MAX_INPUT_DEPTH}` };
  const cycles = ctx.cycles;
  ctx.active.add(key);
  let result;
  try {
    const own = await ownTrace(ctx, npm, version, depth);
    if (own.ok) result = own;
    else {
      const entry = ctx.known.get(key);
      if (!entry) result = own;
      else {
        const next = await successor(ctx, npm, version, depth);
        result = next
          ? { ok: false, known: [], reason: `${key} is on the known list (#${entry.issue}), but ${npm}@${next} is attested, so the entry has expired: bump to it` }
          : { ok: true, known: [key], reason: '' };
      }
    }
  } finally {
    ctx.active.delete(key);
  }
  if (ctx.cycles === cycles) ctx.memo.set(key, result);
  return result;
}

async function ownTrace(ctx, npm, version, depth) {
  const key = `${npm}@${version}`;
  const fail = (reason) => ({ ok: false, known: [], reason: `${key}: ${reason}` });
  const packument = await ctx.registry.packument(npm);
  const meta = packument?.versions?.[version];
  if (!meta) return fail("it isn't published");
  let traced = null;
  let pkg = null;
  for (const dir of recipeDirs(meta, npm)) {
    const t = await trace({ pkg: dir, npm, from: version, registry: ctx.registry, readAt: ctx.readAt, reproduced: ctx.reproduced });
    traced = t;
    pkg = dir;
    if (!/ has no packages\/[^/]+\/recipe\.yaml$/.test(t.reason)) break;
  }
  if (!traced.attested) return fail(traced.reason);
  const commit = traced.chain[traced.chain.length - 1].commit;
  const recipeText = ctx.readAt(commit, `packages/${pkg}/recipe.yaml`);
  const recipe = parseRecipe(recipeText);
  const named = recipe.npm || `@ai-ecoverse/${pkg}`;
  if (named !== npm) return fail(`packages/${pkg}/recipe.yaml at ${commit.slice(0, 12)} builds ${named}, not ${npm}`);
  const build = buildFiles(ctx.readAt, commit, pkg);
  const found = inputsAt({ readAt: ctx.readAt, commit, pkg, recipeText, recipe, files: build ? build.files : [] });
  if (found.problems.length) return fail(`its build at ${commit.slice(0, 12)} can't be read in full: ${found.problems.join(', ')}`);
  const knownSet = new Set();
  for (const input of found.inputs) {
    const r = await checkInput(ctx, input.npm, input.version, depth + 1);
    if (!r.ok) return { ok: false, known: [], reason: `${key} needs ${r.reason}` };
    r.known.forEach((k) => knownSet.add(k));
  }
  return { ok: true, known: [...knownSet], reason: '' };
}

export function recipeDirOf(meta) {
  return meta?.homescoop?.recipe || String(meta?.repository?.directory || '').match(/^packages\/([^/]+)(?:\/package)?\/?$/)?.[1] || null;
}

const lineOf = (v) => String(v).match(/^(\d+\.\d+)\./)?.[1] ?? null;

export function sameChannel(listedMeta, listed, meta, version) {
  const a = recipeDirOf(listedMeta);
  const b = recipeDirOf(meta);
  if (!a || !b || a === b) return true;
  return lineOf(listed) !== null && lineOf(listed) === lineOf(version) && compareVersions(version, listed) > 0;
}

async function successor(ctx, npm, version, depth) {
  const key = `${npm}@${version}`;
  const packument = await ctx.registry.packument(npm);
  const time = packument?.time || {};
  const at = Date.parse(time[version] || '');
  const later = Object.keys(packument?.versions || {})
    .filter((v) => v !== version)
    .filter((v) => !Number.isFinite(at) || !Number.isFinite(Date.parse(time[v] || '')) || Date.parse(time[v]) > at)
    .sort((a, b) => (Date.parse(time[b] || '') || 0) - (Date.parse(time[a] || '') || 0));
  const listed = packument?.versions?.[version];
  for (const v of later) {
    const meta = packument.versions[v];
    if (!sameChannel(listed, version, meta, v)) continue;
    const prov = checkProvenance(await ctx.registry.attestations(npm, v), { npm, version: v, integrity: meta?.dist?.integrity });
    if (!prov.ok) continue;
    const r = await ownTrace(ctx, npm, v, depth);
    if (r.ok && !r.known.includes(key)) return v;
  }
  return null;
}

export async function buildInputVerdict({ checker, readAt, commit, pkg, recipeText, recipe, files }) {
  const found = inputsAt({ readAt, commit, pkg, recipeText, recipe, files });
  const inputs = found.inputs.map((i) => ({ input: `${i.npm}@${i.version}`, via: i.via }));
  if (found.problems.length) return { inputs, attested: false, reason: `its build inputs can't be read in full: ${found.problems.join(', ')}`, known: [] };
  const knownSet = new Set();
  const reasons = [];
  for (const [n, input] of found.inputs.entries()) {
    const r = await checker.check(input.npm, input.version);
    inputs[n].ok = r.ok;
    if (r.known.length) inputs[n].known = r.known;
    if (!r.ok) reasons.push(`build input ${r.reason} (${input.via})`);
    r.known.forEach((k) => knownSet.add(k));
  }
  const known = [...knownSet].map((k) => `links unattested ${k} (homescoop#${checker.ctx.known.get(k).issue})`);
  return { inputs, attested: !reasons.length, reason: reasons.join('; '), known };
}

export async function repackInput({ pkg, ref, npm, readAt, registry, reproduced = {}, known = new Map() }) {
  const read = memoReader(readAt);
  const reg = memoRegistry(registry);
  const text = read(ref, `packages/${pkg}/recipe.yaml`);
  if (text == null) throw new Error(`no packages/${pkg}/recipe.yaml at ${ref}`);
  const recipe = parseRecipe(text);
  const from = recipe.repack && typeof recipe.repack === 'object' ? recipe.repack.from : '';
  const name = npm || recipe.npm || `@ai-ecoverse/${pkg}`;
  let out;
  let at;
  if (!from) {
    const label = `${pkg} at ${/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 12) : ref}`;
    const rule = sourceRule({ pkg, commit: ref, readAt: read, recipe, label });
    out = { package: pkg, npm: name, repack: false, built: true, chain: [], root: null, buildFiles: rule.files ? rule.files.map((f) => f.path) : [], prebuilt: rule.prebuilt, sourceSha256: rule.sha || null };
    if (rule.reasons.length) return { ...out, attested: false, reason: rule.reasons.join('; ') };
    if (rule.inTree) out = { ...out, inTree: rule.inTree, attested: true, reason: `${label} builds its in-tree source (${rule.inTree.join(', ')}), downloads nothing unpinned and can't stage a prebuilt` };
    else out = { ...out, attested: true, reason: `${label} fetches the pinned source (${rule.sha}) and can't stage a prebuilt` };
    at = { commit: ref, recipeText: text, recipe, files: rule.files || [] };
  } else {
    out = await trace({ pkg, npm: name, from, registry: reg, readAt: read, reproduced });
    if (!out.attested) return out;
    const commit = out.chain[out.chain.length - 1].commit;
    const recipeText = read(commit, `packages/${pkg}/recipe.yaml`);
    const build = buildFiles(read, commit, pkg);
    at = { commit, recipeText, recipe: parseRecipe(recipeText), files: build ? build.files : [] };
  }
  const checker = inputChecker({ registry: reg, readAt: read, known, reproduced });
  const inputs = await buildInputVerdict({ checker, readAt: read, pkg, ...at });
  out = { ...out, inputs: inputs.inputs, known: inputs.known };
  if (!inputs.attested) return { ...out, attested: false, reason: inputs.reason };
  return out;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { values } = parseArgs({
    options: {
      package: { type: 'string' },
      ref: { type: 'string', default: 'HEAD' },
      repo: { type: 'string' },
      npm: { type: 'string' },
      reproduced: { type: 'string' },
      fixtures: { type: 'string' },
      known: { type: 'string' },
    },
  });
  if (!values.package) {
    console.error('usage: repack-input.mjs --package <recipe dir> [--ref <commit>] [--repo owner/repo] [--npm <name>] [--reproduced <file>] [--fixtures <dir>] [--known <file>]');
    process.exit(2);
  }
  try {
    const readAt = values.fixtures ? fixtureReader(values.fixtures) : values.repo ? githubReader(values.repo) : gitReader();
    const registry = values.fixtures ? fixtureRegistry(values.fixtures) : npmRegistry();
    const reproduced = values.reproduced ? JSON.parse(readFileSync(values.reproduced, 'utf8')) : {};
    const known = readKnownInputs(values.known || KNOWN_INPUTS);
    const out = await repackInput({ pkg: values.package, ref: values.ref, npm: values.npm, readAt, registry, reproduced, known });
    console.log(JSON.stringify(out, null, 2));
    if (out.attested === true) console.error(`repack-input: PASS ${values.package}: attested${out.known?.length ? `, known ${out.known.length}` : ''}`);
    else console.error(`repack-input: FAIL ${values.package}: unverifiable: ${out.reason ?? 'no reason'}`);
    process.exit(out.attested === true ? 0 : 1);
  } catch (error) {
    console.log(JSON.stringify({ package: values.package, error: String(error.message || error) }, null, 2));
    console.error(`repack-input: FAIL ${values.package}: trace error: ${String(error.message || error).split('\n')[0]}`);
    process.exit(2);
  }
}
