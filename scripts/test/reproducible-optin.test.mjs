// Every built recipe (builder: host, no repack:) opts into reproducible:, so
// ladder-pr's rebuild/reproducible jobs show the published bytes come from
// the recipe (homescoop#569, #675). Allowlisted recipes are known gaps, each
// with its issue; drop a line when the recipe opts in (a stale line fails).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** recipe -> issue that tracks its missing reproducible: opt-in */
const ALLOW = new Map([
  ['bash', 808],
  ['binutils', 808],
  ['bzip2', 808],
  ['cmake', 808],
  ['coreutils', 808],
  ['curl', 808],
  ['diffutils', 808],
  ['emscripten-cache', 808],
  ['file', 808],
  ['findutils', 808],
  ['freetype', 808],
  ['gawk', 808],
  ['gmake', 808],
  ['grep', 808],
  ['gzip', 808],
  ['imagemagick-heif', 808],
  ['imagemagick-relink', 808],
  ['imagemagick', 808],
  ['jq', 808],
  ['lcms2', 808],
  ['less', 808],
  ['libheif', 808],
  ['libiconv', 808],
  ['libpng', 808],
  ['libtiff', 808],
  ['libwebp', 808],
  ['libxml2', 808],
  ['mount', 808],
  ['nano', 808],
  ['ncurses-utils', 808],
  ['openjpeg', 808],
  ['patch', 808],
  ['poppler', 808],
  ['procps', 808],
  ['py-python-dateutil', 808],
  ['py-pytz', 808],
  ['py-six', 808],
  ['py-tzdata', 808],
  ['qpdf', 808],
  ['rsync', 808],
  ['sed', 808],
  ['sqlite3', 808],
  ['tar', 808],
  ['tree', 808],
  ['util-linux', 808],
  ['wasi-biome', 808],
  ['wasi-esbuild', 808],
  ['wasi-ripgrep', 808],
  ['wasi-typescript', 808],
  ['wasix-gnupg', 808],
  ['wasix-m4', 808],
  ['wasix-openssh', 808],
  ['wasix-openssl', 808],
  ['wasix-python', 808],
  ['wasix-sysroot', 808],
  ['wasix-websocat', 808],
  ['wasix-zlib', 808],
  ['wasm-go-std-linux-amd64', 808],
  ['wasm-go-std-wasip1', 808],
  ['wasm-go', 808],
  ['which', 808],
  ['xxd', 808],
  ['xz', 808],
  ['zlib', 808],
]);

function recipe(p) {
  const r = spawnSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), p, '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || `read-recipe.mjs ${p} failed`);
  return JSON.parse(r.stdout);
}

const optedIn = (v) => v === 'true' || v === true || (v && typeof v === 'object' && typeof v.path === 'string');

const packages = readdirSync(join(root, 'packages')).filter((p) => existsSync(join(root, 'packages', p, 'recipe.yaml'))).sort();
const recipes = new Map(packages.map((p) => [p, recipe(p)]));
const built = packages.filter((p) => {
  const r = recipes.get(p);
  const repack = r.repack && typeof r.repack === 'object' && r.repack.from;
  return r.builder === 'host' && !repack;
});

test('every built recipe opts into reproducible: or is allowlisted with an issue', () => {
  const missing = built.filter((p) => !optedIn(recipes.get(p).reproducible) && !ALLOW.has(p));
  assert.deepEqual(missing, [], `add reproducible: true to packages/<name>/recipe.yaml (or allowlist with an issue): ${missing.join(', ')}`);
});

test('the allowlist has no stale entries', () => {
  const stale = [...ALLOW.keys()].filter((p) => !built.includes(p) || optedIn(recipes.get(p).reproducible));
  assert.deepEqual(stale, [], `drop from ALLOW (opted in, repacked, retired or gone): ${stale.join(', ')}`);
  for (const [p, n] of ALLOW) assert.ok(Number.isInteger(n) && n > 0, `${p}: issue number`);
});

test('wasi-uv (#675) and py-kiwisolver (#569) opt in', () => {
  for (const p of ['wasi-uv', 'py-kiwisolver']) assert.ok(optedIn(recipes.get(p).reproducible), p);
});
