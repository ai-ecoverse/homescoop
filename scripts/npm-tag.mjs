#!/usr/bin/env node
/**
 * The npm dist-tag a recipe publishes under (recipe.yaml `npm-tag:`), and the
 * lookups from an npm name to its recipe dirs when one name has a tagged
 * recipe beside its latest one (a wave, docs/ladder-builds.md).
 *
 *   node scripts/npm-tag.mjs <recipe dir> [--root <checkout>]   # prints the effective tag
 *   node scripts/npm-tag.mjs --check <tag>    # exit 0 if a recipe may use it
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_TAG = 'latest';
export const TAG_PATTERN = /^python\d+\.\d+$/;
export const RESERVED_TAGS = new Set(['latest', 'certified', 'next']);

export function tagProblem(tag) {
  const t = String(tag ?? '');
  if (RESERVED_TAGS.has(t)) return `npm-tag "${t}" is reserved: leave npm-tag out to publish under latest`;
  if (!TAG_PATTERN.test(t)) return `npm-tag "${t}" doesn't match ${TAG_PATTERN}`;
  return '';
}

export function cliTagProblem(tag) {
  return tag === DEFAULT_TAG ? '' : tagProblem(tag);
}

function scalar(text, key) {
  const m = String(text ?? '').match(new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*(?:#.*)?$`, 'm'));
  if (!m) return undefined;
  const v = m[1];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

export function recipeTag(text) {
  const tag = scalar(text, 'npm-tag');
  if (tag === undefined) return DEFAULT_TAG;
  const problem = tagProblem(tag);
  if (problem) throw new Error(problem);
  return tag;
}

export function recipeOf(dir, root = defaultRoot) {
  const recipePath = join(root, 'packages', dir, 'recipe.yaml');
  if (!existsSync(recipePath)) throw new Error(`no packages/${dir}/recipe.yaml`);
  const text = readFileSync(recipePath, 'utf8');
  const pkgPath = join(root, 'packages', dir, 'package', 'package.json');
  const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};
  return {
    dir,
    npm: scalar(text, 'npm') || pkg.name || `@ai-ecoverse/${dir}`,
    upstream: scalar(text, 'version') ?? null,
    version: pkg.version ?? null,
    retired: scalar(text, 'builder') === 'retired',
    tagText: scalar(text, 'npm-tag'),
    tag: recipeTag(text),
  };
}

export function listRecipes(root = defaultRoot) {
  return readdirSync(join(root, 'packages'))
    .filter((d) => existsSync(join(root, 'packages', d, 'recipe.yaml')))
    .sort()
    .map((d) => recipeOf(d, root));
}

export function byName(recipes) {
  const out = new Map();
  for (const r of recipes) {
    if (!out.has(r.npm)) out.set(r.npm, []);
    out.get(r.npm).push(r);
  }
  return out;
}

const base = (v) => String(v ?? '').replace(/-[^-]*$/, '');
const npmify = (v) => String(v).replace(/^(\d+)$/, '$1.0.0').replace(/^(\d+\.\d+)$/, '$1.0');

export function pickRecipe(recipes, name, version) {
  const all = recipes.filter((r) => r.npm === name);
  if (all.length <= 1) return all[0] ?? null;
  if (version) {
    const byTag = all.filter((r) => r.tag === version);
    if (byTag.length === 1) return byTag[0];
    const exact = all.filter((r) => r.version === version);
    if (exact.length === 1) return exact[0];
    const line = all.filter((r) => r.upstream && base(version) === npmify(r.upstream));
    if (line.length === 1) return line[0];
  }
  const latest = all.filter((r) => r.tag === DEFAULT_TAG && !r.retired);
  return latest.length === 1 ? latest[0] : null;
}

export const ALLOWLIST = join(defaultRoot, 'scripts/npm-tag-allowlist.txt');

export function parseAllowlist(text) {
  const entries = [];
  const problems = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(@[a-z0-9-]+\/[a-z0-9._-]+)\s+#(\d+)\s+(\S.*)$/);
    if (!m) problems.push(`npm-tag-allowlist.txt: "${line}" is not "<@scope/name> #<issue> <reason>"`);
    else entries.push({ npm: m[1], issue: Number(m[2]), reason: m[3], line });
  }
  return { entries, problems };
}

export function channelProblems(root = defaultRoot, allowText = existsSync(ALLOWLIST) ? readFileSync(ALLOWLIST, 'utf8') : '') {
  const problems = [];
  const recipes = [];
  for (const dir of readdirSync(join(root, 'packages')).sort()) {
    if (!existsSync(join(root, 'packages', dir, 'recipe.yaml'))) continue;
    try {
      recipes.push(recipeOf(dir, root));
    } catch (err) {
      problems.push(`packages/${dir}/recipe.yaml: ${err.message}`);
    }
  }
  const live = recipes.filter((r) => !r.retired);
  const { entries, problems: bad } = parseAllowlist(allowText);
  problems.push(...bad);
  const allowed = new Map(entries.map((e) => [e.npm, e]));
  for (const [npm, list] of byName(live)) {
    const perTag = new Map();
    for (const r of list) perTag.set(r.tag, [...(perTag.get(r.tag) ?? []), r.dir]);
    for (const [tag, dirs] of perTag) {
      if (dirs.length > 1) problems.push(`${npm}: ${dirs.map((d) => `packages/${d}`).join(' and ')} all publish under ${tag}; at most one recipe per tag, so give the wave's dir a non-latest npm-tag`);
    }
    if (list.length > 1 && !allowed.has(npm)) {
      problems.push(`${npm} has ${list.length} recipes (${list.map((r) => `packages/${r.dir} ${r.tag}`).join(', ')}): add "${npm} #<wave issue> <reason>" to scripts/npm-tag-allowlist.txt`);
    }
  }
  const counts = byName(live);
  for (const e of entries) {
    const n = counts.get(e.npm)?.length ?? 0;
    if (n < 2) problems.push(`scripts/npm-tag-allowlist.txt entry "${e.line}" is stale: ${e.npm} has ${n} recipe${n === 1 ? '' : 's'}; drop it`);
  }
  return problems;
}

function main(args) {
  const argv = [...args];
  const at = argv.indexOf('--root');
  const root = at >= 0 ? argv.splice(at, 2)[1] : defaultRoot;
  if (!root) {
    console.error('usage: npm-tag.mjs <recipe dir> [--root <checkout>] | --check <tag>');
    return 2;
  }
  if (argv[0] === '--check' && argv.length === 2) {
    const problem = tagProblem(argv[1]);
    if (problem) {
      console.error(problem);
      return 1;
    }
    return 0;
  }
  if (argv.length !== 1 || argv[0].startsWith('-')) {
    console.error('usage: npm-tag.mjs <recipe dir> [--root <checkout>] | --check <tag>');
    return 2;
  }
  try {
    console.log(recipeOf(argv[0], root).tag);
    return 0;
  } catch (err) {
    console.error(`npm-tag: packages/${argv[0]}: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) process.exit(main(process.argv.slice(2)));
