#!/usr/bin/env node
/**
 * Refuse a stale repack (#735): a recipe with `repack: from: X` reuses X's
 * bytes, so any build input changed since the tree that really built them
 * would ship unbuilt (wasix-perl 5.42.0-15's flock fix, #734).
 *
 *   node scripts/repack-inputs.mjs <package>     (exit 1 when stale)
 *
 * The root is found from git history: the newest first-parent commit whose
 * packages/<n>/package/package.json has version X; when the recipe there is
 * itself a repack, follow its repack.from on down to the build. Then compare
 * that tree with the working tree:
 *
 *   - every file under packages/<n>/ is a build input, except package/,
 *     cert/, test/, smoke.c, smoke.ldflags, browser-cert.json, *.md, recipe.yaml, and the
 *     sources of repack.files and repack.patches;
 *   - recipe.yaml is compared as data, minus the keys that don't reach the
 *     build: about, summary, name, npm, repack, reproducible, runner and
 *     dependencies.run, and source urls whose sha256 is pinned.
 *
 * A recipe whose inputs changed on purpose without changing the bytes says
 * why: `repack: inputs_changed: "<reason>"`. Drop it together with repack:.
 *
 * scripts/repack-inputs-allowlist.txt holds the changes that predate this
 * check, each pinned to the file's content so a later edit fails again:
 *   <package> <path under packages/<n>/> <git blob sha, or `deleted`> #<issue> <reason>
 * (recipe.yaml's pin is the sha256 of its build fields, see buildView).
 *
 * Needs full history; a shallow clone is unshallowed with `git fetch`.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));

const NOT_INPUT = [/^package\//, /^cert\//, /^test\//, /^smoke\.c$/, /^smoke\.ldflags$/, /^browser-cert\.json$/, /\.md$/, /^recipe\.yaml$/];
const RECIPE_NOT_INPUT = ['about', 'summary', 'name', 'npm', 'repack', 'reproducible', 'runner'];

function git(root, args, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

/** Parse recipe.yaml text with read-recipe.mjs (it reads only from a tree). */
export function parseRecipe(name, text) {
  const dir = mkdtempSync(join(tmpdir(), 'repack-inputs-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'packages', name), { recursive: true });
    copyFileSync(join(here, 'read-recipe.mjs'), join(dir, 'scripts/read-recipe.mjs'));
    writeFileSync(join(dir, 'packages', name, 'recipe.yaml'), text);
    const r = spawnSync(process.execPath, [join(dir, 'scripts/read-recipe.mjs'), name, '--json'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`read-recipe ${name}: ${r.stderr || r.stdout}`);
    return JSON.parse(r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The recipe minus what doesn't reach the build, keys sorted, as JSON. */
export function buildView(recipe) {
  const r = structuredClone(recipe);
  for (const k of RECIPE_NOT_INPUT) delete r[k];
  if (r.dependencies && typeof r.dependencies === 'object') delete r.dependencies.run;
  // A pinned source is its sha256; the url is only where to get it (a mirror move).
  const pinnedUrl = (src) => {
    if (src && typeof src === 'object' && /^[0-9a-f]{64}$/i.test(String(src.sha256 || ''))) delete src.url;
  };
  pinnedUrl(r.source);
  if (r.sources && typeof r.sources === 'object') Object.values(r.sources).forEach(pinnedUrl);
  const sort = (v) =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(r));
}

function ensureHistory(root) {
  if (git(root, ['rev-parse', '--is-shallow-repository']).trim() !== 'true') return;
  console.log('== repack-inputs: shallow clone, fetching history');
  if (git(root, ['fetch', '--quiet', '--unshallow', '--no-tags', 'origin'], { allowFail: true }) === null) {
    throw new Error('shallow clone and `git fetch --unshallow` failed; check out with fetch-depth: 0');
  }
}

/** The git blob sha of a working-tree file, or `deleted`. */
export function blobOf(root, path) {
  if (!existsSync(join(root, path))) return 'deleted';
  return git(root, ['hash-object', '--', path]).trim();
}

/** recipe.yaml's allowlist pin: sha256 of buildView(). */
export function recipePin(view) {
  return createHash('sha256').update(view).digest('hex');
}

/** `<package> <path> <pin>` keys of the allowlist; malformed lines throw. */
export function readAllowlist(path) {
  const out = new Set();
  if (!existsSync(path)) return out;
  for (const [i, raw] of readFileSync(path, 'utf8').split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+) (\S+) ([0-9a-f]{40}|[0-9a-f]{64}|deleted) #\d+ \S/);
    if (!m) throw new Error(`${path}:${i + 1}: want "<package> <path> <blob sha|deleted> #<issue> <reason>", got "${line}"`);
    out.add(`${m[1]} ${m[2]} ${m[3]}`);
  }
  return out;
}

/** Newest first-parent commit where packages/<name>/package/package.json is at `version`. */
function commitOf(root, name, version) {
  const pj = `packages/${name}/package/package.json`;
  const log = git(root, ['log', '--first-parent', '--format=%H', 'HEAD', '--', pj]).split('\n').filter(Boolean);
  for (const c of log) {
    const text = git(root, ['show', `${c}:${pj}`], { allowFail: true });
    if (text === null) continue;
    let v;
    try {
      v = JSON.parse(text).version;
    } catch {
      continue;
    }
    if (v === version) return c;
  }
  return null;
}

/**
 * @param {{ root: string, name: string }} o
 * @returns {{ ok: boolean, root?: { version: string, commit: string }, chain: string[], changed: string[], recipeChanged: boolean, reason?: string, error?: string }}
 */
export function checkRepackInputs({ root, name }) {
  const recipePath = join(root, 'packages', name, 'recipe.yaml');
  const recipe = parseRecipe(name, readFileSync(recipePath, 'utf8'));
  const from = String(recipe.repack?.from || '');
  if (!from) return { ok: true, chain: [], changed: [], recipeChanged: false };
  ensureHistory(root);

  const chain = [];
  let version = from;
  let commit = null;
  let rootRecipe = null;
  for (;;) {
    if (chain.includes(version)) return { ok: false, chain, changed: [], recipeChanged: false, error: `repack chain loops at ${version}` };
    chain.push(version);
    commit = commitOf(root, name, version);
    if (!commit) {
      return { ok: false, chain, changed: [], recipeChanged: false, error: `no commit has packages/${name}/package/package.json at ${version}, so the tree that built it is unknown` };
    }
    const text = git(root, ['show', `${commit}:packages/${name}/recipe.yaml`], { allowFail: true });
    if (text === null) return { ok: false, chain, changed: [], recipeChanged: false, error: `${commit} has no packages/${name}/recipe.yaml` };
    rootRecipe = parseRecipe(name, text);
    const next = String(rootRecipe.repack?.from || '');
    if (!next) break;
    version = next;
  }

  const exempt = new Set();
  for (const spec of Array.isArray(recipe.repack?.files) ? recipe.repack.files.map(String) : []) {
    const [f, src] = spec.split('=');
    exempt.add(src ?? f);
  }
  for (const p of Array.isArray(recipe.repack?.patches) ? recipe.repack.patches.map(String) : []) exempt.add(p);

  const prefix = `packages/${name}/`;
  // Working tree vs the root commit, untracked (not ignored) files included.
  const allow = readAllowlist(join(root, 'scripts/repack-inputs-allowlist.txt'));
  const pinned = (p, pin) => allow.has(`${name} ${p} ${pin}`);
  const tracked = git(root, ['diff', '--name-only', '--no-renames', commit, '--', prefix]).split('\n');
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '--', prefix]).split('\n');
  const changed = [...new Set([...tracked, ...untracked])]
    .filter(Boolean)
    .map((p) => p.slice(prefix.length))
    .filter((p) => !NOT_INPUT.some((re) => re.test(p)) && !exempt.has(p))
    .filter((p) => !pinned(p, blobOf(root, prefix + p)))
    .sort();
  const view = buildView(recipe);
  const recipeChanged = view !== buildView(rootRecipe) && !pinned('recipe.yaml', recipePin(view));
  const stale = changed.length > 0 || recipeChanged;
  const reason = String(recipe.repack?.inputs_changed || '').trim();
  const pins = Object.fromEntries(changed.map((p) => [p, blobOf(root, prefix + p)]));
  if (recipeChanged) pins['recipe.yaml'] = recipePin(view);
  return { ok: !stale || Boolean(reason), root: { version, commit }, chain, changed, recipeChanged, pins, reason: stale ? reason : undefined };
}

/** Human-readable verdict; `null` when the repack is fine. */
export function describe(name, res) {
  if (res.error) return `${name}: ${res.error}`;
  if (res.ok && !res.reason) return null;
  const what = [
    ...res.changed.map((f) => `packages/${name}/${f} (blob ${res.pins[f]})`),
    ...(res.recipeChanged ? [`packages/${name}/recipe.yaml (build fields, pin ${res.pins['recipe.yaml']})`] : []),
  ];
  const head = `${name}: build inputs changed since ${res.root.version} (${res.root.commit.slice(0, 12)}), whose bytes this repack reuses (chain ${res.chain.join(' ← ')}):\n  - ${what.join('\n  - ')}`;
  if (res.ok) return `${head}\n  allowed by repack.inputs_changed: ${res.reason}`;
  return `${head}\ndrop repack: and rebuild, or say why the bytes are unchanged with repack: inputs_changed: "<reason>"`;
}

const invoked = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invoked) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: repack-inputs.mjs <package>');
    process.exit(2);
  }
  const root = join(here, '..');
  if (!existsSync(join(root, 'packages', name, 'recipe.yaml'))) {
    console.error(`missing packages/${name}/recipe.yaml`);
    process.exit(2);
  }
  let res;
  try {
    res = checkRepackInputs({ root, name });
  } catch (e) {
    console.error(`repack-inputs (${name}): ${e.message}`);
    process.exit(1);
  }
  const msg = describe(name, res);
  if (!res.ok) {
    console.error(`repack-inputs: ${msg}`);
    process.exit(1);
  }
  console.log(msg ? `== repack-inputs: ${msg}` : `== repack-inputs: ${name}: no build input changed since ${res.root?.version ?? '(not a repack)'}`);
}
