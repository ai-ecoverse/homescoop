#!/usr/bin/env node
/**
 * A repack's input must be attested (cert lane rule, 2026-10-16, from #730),
 * and so must every built recipe's (#864).
 *
 *   node scripts/cert-review/repack-input.mjs --package <recipe dir> [--ref <commit>]
 *     [--repo owner/repo] [--npm <name>] [--reproduced <file.json>] [--fixtures <dir>]
 *   → JSON on stdout: { package, npm, repack, chain, root, attested, reason }
 *     exit 0 when the input is attested, 1 when it
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
 * A recipe that isn't a repack (#864, cert lane ruling on #858/#859) is held
 * to the same static rule at <ref> itself: its recipe and build scripts must
 * fetch the pinned source with the recipe's sha and have no stage or prebuilt
 * path. Its output is { repack: false, built: true, attested, reason }; it
 * needs no provenance, since the bytes under review are the PR's own build.
 *
 * A recipe whose source is committed to this repo declares it, instead of
 * source.url/sha256 (a root kind, accepted by the cert lane on #864):
 *
 *   source:
 *     in-tree: "src Cargo.toml Cargo.lock"   # paths under packages/<pkg>/
 *
 * The declaration is verified, never trusted: every path must be in the tree
 * being judged (the root's commit, or <ref>); the package build files must
 * download nothing a pinned sha256 doesn't cover (no curl, wget, git
 * clone/fetch, or homescoop_fetch without a literal sha256: unpinnedFetches);
 * and the prebuilt rule applies as for any build. One that fails is
 * unverifiable, never skipped.
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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
    const loops = loopWords(body);
    for (const m of body.matchAll(/[^\s;|&<>=`]*\.(?:sh|bash)\b/g)) {
      const raw = m[0].replace(/["']+$/, '');
      const refs = expandLoopVars(raw, loops);
      if (!refs) {
        problems.push(`${path} runs ${raw}, whose package name is a variable this rule can't resolve (only a literal name, or a for-loop over literal names, can be followed)`);
        continue;
      }
      for (const ref of refs) {
        // A package's own build.sh (packages/<x>/…) runs with HOMESCOOP_PKG = <x>.
        const owner = path.match(/^packages\/([^/]+)\//)?.[1] || pkg;
        const { paths, explicit } = resolveRef(ref, path, owner);
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
  }
  return { files, problems };
}

/** `for <var> in <literal words>; do` loops in a script: Map var → words. */
export function loopWords(body) {
  const out = new Map();
  for (const m of String(body).matchAll(/\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([^;\n]*?)\s*(?:;|\n)\s*do\b/g)) {
    const words = m[2].trim().split(/\s+/).map((w) => w.replace(/^(["'])(.*)\1$/, '$2'));
    if (!words.length || !words.every((w) => /^[A-Za-z0-9_.+-]+$/.test(w))) continue;
    out.set(m[1], [...new Set([...(out.get(m[1]) || []), ...words])]);
  }
  return out;
}

/**
 * The references a script path with loop variables stands for: one per loop
 * word ("packages/$r/build.sh" in `for r in a b; do` → packages/a/…, packages/b/…).
 * null when a package name under packages/ is still a variable afterwards,
 * so the caller fails closed instead of guessing.
 */
export function expandLoopVars(ref, loops) {
  let refs = [ref];
  for (const [name, words] of loops) {
    const re = new RegExp(`\\$(?:\\{${name}\\}|${name}(?![A-Za-z0-9_]))`, 'g');
    refs = refs.flatMap((r) => (re.test(r) ? words.map((w) => r.replace(re, w)) : [r]));
  }
  if (refs.some((r) => /(?:^|\/)packages\/[^/]*\$/.test(r))) return null;
  return refs;
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
 * The static root rule, for one recipe at one commit (cert lane, 2026-10-16;
 * #834 for repack roots, #864 for every build): the recipe pins a source
 * sha256, the build fetches it with homescoop_fetch, and no stage or prebuilt
 * path is possible. `label` names the build in the reasons ("root 1.0.0-1",
 * "the build at <ref>"). Throws if the tree can't be read (fail closed).
 * @returns {{ reasons: string[], sha: string, files: { path: string, text: string }[] | null, prebuilt: { path: string, line: number, why: string }[] }}
 */
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
    // An in-tree source (a root kind, not an exception): the declaration is
    // verified, never trusted. A declaration that fails is unverifiable.
    reasons.push(...inTreeReasons({ pkg, commit, readAt, source, paths: inTree, files: build ? build.files : [], label }));
    return { reasons, sha: '', inTree: inTree.split(/\s+/).filter(Boolean), files: build ? build.files : null, prebuilt };
  }
  if (build && !fetchesPinnedSource(build.files, sha)) reasons.push(`${label}'s build never fetches the pinned source (no homescoop_fetch of $SRC_SHA, $SHA or ${sha || 'source.sha256'})`);
  if (!/^[0-9a-f]{64}$/.test(sha)) reasons.push(`${label}'s recipe pins no source sha256 (${sha || 'none'})`);
  return { reasons, sha, inTree: null, files: build ? build.files : null, prebuilt };
}

/**
 * Downloads in the package build files (packages/…/*.sh) that no pinned
 * sha256 covers: curl, wget, git clone/fetch, and a homescoop_fetch whose
 * sha256 isn't a 64-hex literal. The shared scripts/*.sh helpers aren't
 * scanned: their downloads are homescoop_fetch or toolchain installers that
 * check a pinned sha256 (install-emsdk.sh, install-go.sh, …), reviewed as
 * repo code.
 */
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
      for (const m of line.matchAll(/\bhomescoop_fetch\s+("[^"]*"|'[^']*'|\S+)\s+("[^"]*"|'[^']*'|\S+)/g)) {
        if (!/^[0-9a-f]{64}$/.test(m[2].replace(/^["']|["']$/g, ''))) hits.push({ path, line: i + 1, why: `a homescoop_fetch of ${m[1]} with no literal sha256` });
      }
    });
  }
  return hits;
}

/** Why a `source: in-tree:` declaration doesn't hold at <commit> (empty when it does). */
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
    if (!existsSync(file)) return null;
    // A directory reads as its listing, as `git show <commit>:<dir>` does.
    return statSync(file).isDirectory() ? readdirSync(file).sort().join('\n') : readFileSync(file, 'utf8');
  };
}

/** The input verdict for one recipe at <ref>: a repack is traced to its root; a built recipe ({ repack: false, built: true }) gets the root rule itself. */
export async function repackInput({ pkg, ref, npm, readAt, registry, reproduced }) {
  const text = readAt(ref, `packages/${pkg}/recipe.yaml`);
  if (text == null) throw new Error(`no packages/${pkg}/recipe.yaml at ${ref}`);
  const recipe = parseRecipe(text);
  const from = recipe.repack && typeof recipe.repack === 'object' ? recipe.repack.from : '';
  const name = npm || recipe.npm || `@ai-ecoverse/${pkg}`;
  if (!from) {
    // A built recipe (#864): the same static rule a repack's root must meet,
    // on the recipe and build scripts at <ref> itself. No provenance check:
    // the bytes under review are this pull request's own ladder-pr build.
    const label = `${pkg} at ${/^[0-9a-f]{40}$/.test(ref) ? ref.slice(0, 12) : ref}`;
    const rule = sourceRule({ pkg, commit: ref, readAt, recipe, label });
    const out = { package: pkg, npm: name, repack: false, built: true, chain: [], root: null, buildFiles: rule.files ? rule.files.map((f) => f.path) : [], prebuilt: rule.prebuilt, sourceSha256: rule.sha || null };
    if (rule.reasons.length) return { ...out, attested: false, reason: rule.reasons.join('; ') };
    if (rule.inTree) return { ...out, inTree: rule.inTree, attested: true, reason: `${label} builds its in-tree source (${rule.inTree.join(', ')}), downloads nothing unpinned and can't stage a prebuilt` };
    return { ...out, attested: true, reason: `${label} fetches the pinned source (${rule.sha}) and can't stage a prebuilt` };
  }
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
