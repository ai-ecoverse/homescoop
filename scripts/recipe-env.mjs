#!/usr/bin/env node
/**
 * Emit shell exports for a homescoop recipe (version / URL / sha SSOT).
 *
 *   eval "$(node scripts/recipe-env.mjs zlib)"
 *   eval "$(node scripts/recipe-env.mjs bash --source ncurses)"
 *
 * Expands {{version}}, {{major}}, {{minor}}, {{patch}}, {{amal}}, {{year}}
 * in source.url (and sources.<key>.url).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = process.argv[2];
const sourceKey =
  process.argv.includes('--source')
    ? process.argv[process.argv.indexOf('--source') + 1]
    : null;

if (!name || name.startsWith('-')) {
  console.error(
    'usage: recipe-env.mjs <package> [--source <key>]'
  );
  process.exit(2);
}

const recipePath = join(root, 'packages', name, 'recipe.yaml');
if (!existsSync(recipePath)) {
  console.error(`missing ${recipePath}`);
  process.exit(1);
}

const read = spawnSync(
  process.execPath,
  [join(root, 'scripts/read-recipe.mjs'), name, '--json'],
  { encoding: 'utf8', cwd: root }
);
if (read.status !== 0) {
  process.stderr.write(read.stderr || 'read-recipe failed\n');
  process.exit(1);
}
const recipe = JSON.parse(read.stdout);

/** @param {string} v */
function splitVersion(v) {
  const raw = String(v || '');
  // ImageMagick-style 7.1.2-32 → major.minor.patch = 7.1.2, extra = 32
  const m = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[.-](.+))?$/);
  if (!m) return { major: '', minor: '', patch: '', extra: '', amal: '' };
  const major = m[1] || '0';
  const minor = m[2] || '0';
  const patch = m[3] || '0';
  const amal = `${Number(major)}${String(Number(minor)).padStart(2, '0')}${String(Number(patch)).padStart(2, '0')}00`;
  return { major, minor, patch, extra: m[4] || '', amal };
}

/** @param {string} template @param {Record<string, string>} vars */
function expand(template, vars) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
    if (!(k in vars)) {
      console.error(`recipe-env: unknown placeholder {{${k}}} in ${template}`);
      process.exit(1);
    }
    return vars[k];
  });
}

/** @param {string} s */
function shQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

const version = String(recipe.version || '');
const parts = splitVersion(version);

/** @type {Record<string, unknown>} */
let src;
let prefix = '';
if (sourceKey) {
  const sources = /** @type {Record<string, unknown>} */ (recipe.sources || {});
  src = /** @type {Record<string, unknown>} */ (sources[sourceKey]);
  if (!src || typeof src !== 'object') {
    console.error(`recipe-env: missing sources.${sourceKey} in ${name}`);
    process.exit(1);
  }
  prefix = `${sourceKey.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_`;
} else {
  src = /** @type {Record<string, unknown>} */ (recipe.source || {});
}

const srcVersion = String(src.version || version);
const srcParts = splitVersion(srcVersion);
const year = String(src.year || '');
const vars = {
  version: srcVersion,
  major: srcParts.major,
  minor: srcParts.minor,
  patch: srcParts.patch,
  extra: srcParts.extra,
  amal: String(src.amal || srcParts.amal),
  year,
};

const url = expand(String(src.url || ''), vars);
const sha = String(src.sha256 || '');

if (!url) {
  console.error(`recipe-env: ${name}: empty source url`);
  process.exit(1);
}
if (!sha) {
  console.error(`recipe-env: ${name}: empty source.sha256 (run refresh-recipe-sha.mjs)`);
  process.exit(1);
}

const npm = String(recipe.npm || '');
const license = String(
  (recipe.about && /** @type {Record<string, unknown>} */ (recipe.about).license) || ''
);

console.log(`export HOMESCOOP_PKG=${shQuote(join(root, 'packages', name))}`);
console.log(`export NAME=${shQuote(name)}`);
console.log(`export VERSION=${shQuote(version)}`);
console.log(`export NPM_NAME=${shQuote(npm)}`);
console.log(`export RECIPE_LICENSE=${shQuote(license)}`);
console.log(`export ${prefix}SRC_URL=${shQuote(url)}`);
console.log(`export ${prefix}SRC_SHA=${shQuote(sha)}`);
// Aliases used by many build.sh scripts
if (!sourceKey) {
  const tarballName = url.split('?')[0].split('/').filter(Boolean).pop() || '';
  const srcDirName = `${name}-${version}`;
  console.log(`export SRC_URL=${shQuote(url)}`);
  console.log(`export SRC_SHA=${shQuote(sha)}`);
  console.log(`export URL=${shQuote(url)}`);
  console.log(`export SHA=${shQuote(sha)}`);
  console.log(`export VER=${shQuote(srcVersion)}`);
  console.log(`export HOMESCOOP_TARBALL_NAME=${shQuote(tarballName)}`);
  console.log(`export HOMESCOOP_SRC_DIR_NAME=${shQuote(srcDirName)}`);
} else {
  // Secondary: NCURSES_URL / NCURSES_SHA / NCURSES_VER / NCURSES_VERSION
  console.log(`export ${prefix}URL=${shQuote(url)}`);
  console.log(`export ${prefix}SHA=${shQuote(sha)}`);
  console.log(`export ${prefix}VER=${shQuote(srcVersion)}`);
  console.log(`export ${prefix}VERSION=${shQuote(srcVersion)}`);
}
if (year) console.log(`export ${prefix}YEAR=${shQuote(year)}`);
if (vars.amal) console.log(`export ${prefix}AMAL=${shQuote(vars.amal)}`);
