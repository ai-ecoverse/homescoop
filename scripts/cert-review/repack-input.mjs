#!/usr/bin/env node
/**
 * A repack's input must be attested (cert lane rule, 2026-10-16, from #730).
 *
 *   node scripts/cert-review/repack-input.mjs --package <recipe dir> [--ref <commit>]
 *     [--repo owner/repo] [--npm <name>] [--reproduced <file.json>] [--fixtures <dir>]
 *   → JSON on stdout: { package, npm, repack, chain, root, attested, reason }
 *     exit 0 when the input is attested (or the recipe isn't a repack), 1 when it
 *     is unverifiable, 2 when the trace itself couldn't run.
 *
 * A packaging-only repack (recipe.yaml `repack: from:`) reuses the bytes of a
 * published version. This follows `repack: from:` back through the published
 * versions: a version counts as a repack if the recipe.yaml in the tree it was
 * built from has `repack:`. The first version that was actually built is the
 * root. The input is attested only if:
 *
 *   - every version in the chain has an npm provenance attestation whose SLSA
 *     build is ai-ecoverse/homescoop's ladder-build.yml on refs/heads/main,
 *     for the published tarball's own sha512 (a repack in CI is a pure function
 *     of its input and the repo's files; one published from a laptop is not);
 *     its tree is the attested commit, or (with no attestation) the gitHead;
 *   - the root's tree has packages/<package>/recipe.yaml with a pinned
 *     source.sha256 (64 hex, not "skip");
 *   - the root's build fetched that pinned source: build.sh, or a
 *     scripts/*.sh it runs, calls homescoop_fetch (which checks the sha256);
 *   - the root's build couldn't stage a prebuilt artifact instead of
 *     compiling: no env-overridable *_STAGE / *_WHEEL / *_PREBUILT /
 *     *_RELEASE_URL / *_ARTIFACT input, no tree outside the repo ($ROOT/..),
 *     no download of homescoop's own release artifacts. This is a static rule
 *     on the build script at the root's commit: the run doesn't record which
 *     path it took, and a default stage dir can be filled by a cache, so a
 *     prebuilt path that was *possible* already makes the root unverifiable.
 *
 * A root with no attestation can still count if it was reproduced from its
 * pinned source: --reproduced is a JSON object { "<npm>@<version>":
 * "<dist.integrity of an independent rebuild>" }, and it counts when the
 * integrity matches the published one. The prebuilt and pinned-source rules
 * apply to it too.
 *
 * Not checked: the sigstore signature on the attestation bundle. npm verifies
 * it at publish time and serves it over HTTPS; `npm audit signatures` checks
 * it again offline if needed.
 *
 * Trees are read with `git show` in the current clone, or with the GitHub
 * contents API when --repo is given. The registry is registry.npmjs.org, or
 * the recorded fixtures in --fixtures (<dir>/packument/<npm, / as %2f>.json,
 * <dir>/attestations/<npm, / as %2f>@<version>.json, <dir>/tree/<commit>/<path>).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export const REPO_URL = 'https://github.com/ai-ecoverse/homescoop';
export const PUBLISH_WORKFLOWS = ['.github/workflows/ladder-build.yml'];
export const MAIN = 'refs/heads/main';
const SLSA = 'https://slsa.dev/provenance/v1';

/** Prebuilt inputs a build script can take instead of compiling the pinned source. */
export const PREBUILT = [
  {
    re: /\$\{([A-Za-z0-9_]*(?:STAGE|STAGED|WHEEL|WHL|PREBUILT|RELEASE_URL|ARTIFACT)[A-Za-z0-9_]*):?[-=?]/g,
    why: (m) => `env-overridable prebuilt input ${m[1]}`,
  },
  { re: /\$\{?ROOT\}?\/\.\./g, why: () => 'a tree outside the repo ($ROOT/..)' },
  { re: /ai-ecoverse\/homescoop\/releases\/download/g, why: () => "a download of homescoop's own release artifacts" },
];

/**
 * The recipe.yaml subset this needs: top-level scalars and one level of
 * nested map scalars (source.url, source.sha256, repack.from).
 * @param {string} text
 */
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

/**
 * The shell scripts a reference in <from> can mean, most specific first, and
 * whether the reference is explicit (it names the repo or the package dir,
 * so a missing file is an error, not a path into the fetched source).
 */
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
  // Anything else (./x.sh, bash x.sh, $VAR/x.sh): the package's own file if
  // there is one, else the referencing file's directory; otherwise it points
  // into the fetched source or the work dir, which the pinned sha covers.
  const tail = ref.replace(/^.*\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\//, '').replace(/^.*\)\//, '');
  if (tail.startsWith('/') || !/^[A-Za-z0-9_.\/-]+\.(?:sh|bash)$/.test(tail)) return { paths: [], explicit: false };
  return { paths: [...new Set([norm(`packages/${pkg}/${tail}`), norm(`${dir}/${tail}`)])], explicit: false };
}

/**
 * build.sh and every repo shell script it runs or sources, recursively
 * (scripts/*.sh, package-local helpers, $(dirname "$0")/…), up to MAX_DEPTH.
 * @returns {{ files: { path: string, text: string }[], problems: string[] } | null} null without build.sh
 */
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
    for (const m of body.matchAll(/[^\s;|&<>=`]*\.(?:sh|bash)\b/g)) {
      const ref = m[0].replace(/["']+$/, '');
      const { paths, explicit } = resolveRef(ref, path, pkg);
      const found = paths.find((p) => p === path || seen.has(p) || read(p) != null);
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
  return { files, problems };
}

/** Prebuilt inputs the build files could take: [{ path, line, why }]. */
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

/**
 * Whether the build fetches the recipe's own source: a homescoop_fetch whose
 * sha256 argument is the recipe's source.sha256, as $SRC_SHA / $SHA (which
 * build-common.sh's homescoop_load_recipe exports from it, recipe-env.mjs)
 * or as the same literal. A $SRC_SHA / $SHA after the same script
 * reassigned it doesn't count. The URL doesn't matter: the sha256 pins the bytes.
 */
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

/**
 * The SLSA provenance of <npm>@<version>, checked against homescoop's ladder on main.
 * @returns {{ ok: boolean, reason: string, commit?: string, run?: string }}
 */
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

/**
 * Follow `repack: from:` back to the first built version and decide whether it is attested.
 * @param {{ pkg: string, npm: string, from: string,
 *   registry: { packument(npm: string): Promise<any>, attestations(npm: string, version: string): Promise<any> },
 *   readAt(commit: string, path: string): string | null, reproduced?: Record<string, string> }} o
 */
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
    // The root: the first version that was actually built.
    const root = version;
    const reasons = [];
    const sha = recipe.source && typeof recipe.source === 'object' ? recipe.source.sha256 : '';
    const build = buildFiles(readAt, commit, pkg);
    const files = build?.files;
    if (!build) {
      reasons.push(`root ${root}'s tree has no packages/${pkg}/build.sh`);
    } else {
      const hits = prebuiltInputs(files);
      if (hits.length) {
        reasons.push(`root staged a prebuilt artifact: ${root}'s build can take ${hits.map((h) => `${h.why} (${h.path}:${h.line})`).join(', ')}`);
      }
      if (build.problems.length) reasons.push(`root ${root}'s build can't be read in full: ${build.problems.join(', ')}`);
      if (!fetchesPinnedSource(files, sha)) reasons.push(`root ${root}'s build never fetches the pinned source (no homescoop_fetch of $SRC_SHA, $SHA or ${sha || 'source.sha256'})`);
      link.buildFiles = files.map((f) => f.path);
      link.prebuilt = hits;
    }
    if (!/^[0-9a-f]{64}$/.test(sha || '')) reasons.push(`root ${root}'s recipe pins no source sha256 (${sha || 'none'})`);
    link.sourceSha256 = sha || null;
    const rebuilt = reproduced[`${npm}@${root}`];
    const reproducedOk = Boolean(rebuilt) && rebuilt === meta.dist?.integrity;
    link.reproduced = reproducedOk;
    if (!prov.ok && !reproducedOk) {
      reasons.push(`root ${root} has no provenance from homescoop's ladder on main (${prov.reason}) and no reproducible rebuild on record${rebuilt ? ' (a rebuild gave other bytes)' : ''}`);
    }
    if (reasons.length) return result(false, reasons.join('; '), root);
    return result(true, prov.ok ? `root ${root} built by ${prov.run || 'ladder-build on main'} from the pinned source` : `root ${root} reproduced from the pinned source`, root);
  }
}

/** Trees from the current git clone. */
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

/** Trees from the GitHub contents API (gh). */
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
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  };
}

/** The repack-input verdict for one recipe at <ref> (a recipe with no repack: is { repack: false }). */
export async function repackInput({ pkg, ref, npm, readAt, registry, reproduced }) {
  const text = readAt(ref, `packages/${pkg}/recipe.yaml`);
  if (text == null) throw new Error(`no packages/${pkg}/recipe.yaml at ${ref}`);
  const recipe = parseRecipe(text);
  const from = recipe.repack && typeof recipe.repack === 'object' ? recipe.repack.from : '';
  const name = npm || recipe.npm || `@ai-ecoverse/${pkg}`;
  if (!from) return { package: pkg, npm: name, repack: false, chain: [], root: null, attested: null, reason: 'not a repack' };
  return trace({ pkg, npm: name, from, registry, readAt, reproduced });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { values } = parseArgs({
    options: {
      package: { type: 'string' },
      ref: { type: 'string', default: 'HEAD' },
      repo: { type: 'string' },
      npm: { type: 'string' },
      reproduced: { type: 'string' },
      fixtures: { type: 'string' },
    },
  });
  if (!values.package) {
    console.error('usage: repack-input.mjs --package <recipe dir> [--ref <commit>] [--repo owner/repo] [--npm <name>] [--reproduced <file>] [--fixtures <dir>]');
    process.exit(2);
  }
  try {
    const readAt = values.fixtures ? fixtureReader(values.fixtures) : values.repo ? githubReader(values.repo) : gitReader();
    const registry = values.fixtures ? fixtureRegistry(values.fixtures) : npmRegistry();
    const reproduced = values.reproduced ? JSON.parse(readFileSync(values.reproduced, 'utf8')) : {};
    const out = await repackInput({ pkg: values.package, ref: values.ref, npm: values.npm, readAt, registry, reproduced });
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.attested === false ? 1 : 0);
  } catch (error) {
    console.log(JSON.stringify({ package: values.package, error: String(error.message || error) }, null, 2));
    process.exit(2);
  }
}
