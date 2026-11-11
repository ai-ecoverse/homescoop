import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { REPORTS, olderThan, recipeVersion, reportsVersion } from '../../packages/wasi-uv/cert/lib/version.mjs';
import { COMMAND, FIXED_IN, SPURIOUS, checkExport, expectedExport, exportsSpurious } from '../../packages/wasi-uv/cert/export.mjs';

const dir = new URL('../../packages/wasi-uv/', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package/package.json', dir), 'utf8'));
const recipe = readFileSync(new URL('recipe.yaml', dir), 'utf8');
const certDir = new URL('cert/', dir);
const specs = readdirSync(certDir).filter((f) => f.endsWith('.mjs'));
const source = (f) => readFileSync(new URL(f, certDir), 'utf8');

const uvSays = (v) => `uv ${v} (wasm32-wasip1-threads)\n`;
const uvxSays = (v) => `uvx ${v} (wasm32-wasip1-threads)\n`;
const cfgSays = (v) => `home = /usr/bin\ninclude-system-site-packages = false\nversion_info = 3.14.2\nuv = ${v}\nlrwxrwxrwx 1 u u 15 Oct 27 03:14 /home/u/.venv/bin/python -> /usr/bin/python3\n`;

const EXPORTED_BY_0_13_2 = "bridge==1.0.0 ; sys_platform == 'linux'\nleaf-b==1.0.0\nshared==1.0.0 ; sys_platform == 'linux'\nshared==2.0.0 ; sys_platform != 'linux'\n";
const EXPORTED_BY_0_13_3 = "bridge==1.0.0 ; sys_platform == 'linux'\nleaf-b==1.0.0\nleaf-c==1.0.0 ; sys_platform != 'linux'\nshared==1.0.0 ; sys_platform == 'linux'\nshared==2.0.0 ; sys_platform != 'linux'\n";
const ran = (stdout, status = 0, stderr = '') => ({ status, stdout, stderr });

test('recipe.yaml, package.json and the spec agree on the upstream', () => {
  assert.equal(recipeVersion(), pkg.homescoop.upstream);
  assert.equal(recipeVersion(recipe), pkg.homescoop.upstream);
  assert.match(pkg.version, new RegExp(`^${pkg.homescoop.upstream.replaceAll('.', '\\.')}-\\d+$`));
});

test('no cert spec pins a uv version in an assertion, so a Renovate bump needs no cert edit', () => {
  for (const f of specs) {
    assert.doesNotMatch(source(f), /\^uvx? (?:= )?\d+\\\.\d+/, `${f} pins a uv version`);
  }
  const checklist = source('checklist.mjs');
  const v = recipeVersion();
  assert.ok(!checklist.includes(v), `checklist.mjs names ${v}`);
  assert.ok(!checklist.includes(v.replaceAll('.', '\\.')), `checklist.mjs names ${v} as a regex`);
  for (const what of Object.keys(REPORTS)) {
    assert.ok(checklist.includes(`reportsVersion(assert, '${what}'`), `checklist.mjs checks ${what} against recipe.yaml's version`);
  }
});

test("uv --version, pyvenv.cfg and uvx --version that name recipe.yaml's version pass", () => {
  const v = recipeVersion();
  reportsVersion(assert, 'uv --version', uvSays(v));
  reportsVersion(assert, 'pyvenv.cfg', cfgSays(v));
  reportsVersion(assert, 'uvx --version', uvxSays(v));
  reportsVersion(assert, 'uv --version', `uv ${v} (502f93ca6 2026-10-19 wasm32-wasip1-threads)\n`);
  reportsVersion(assert, 'uvx --version', `uvx ${v}\n`);
});

test('a future upstream passes with no spec change', () => {
  const v = recipeVersion(recipe.replace(/^version: ".*"$/m, 'version: "0.14.0"'));
  assert.equal(v, '0.14.0');
  reportsVersion(assert, 'uv --version', uvSays(v), v);
  reportsVersion(assert, 'pyvenv.cfg', cfgSays(v), v);
  reportsVersion(assert, 'uvx --version', uvxSays(v), v);
});

test('NEGATIVE: a deliberately wrong expected version fails', () => {
  const v = recipeVersion();
  for (const wrong of ['0.13.2', '0.13.30', '0.1.3', '1.13.3']) {
    assert.throws(() => reportsVersion(assert, 'uv --version', uvSays(v), wrong), new RegExp(`uv --version names uv ${wrong.replaceAll('.', '\\.')}, recipe\\.yaml's version`));
    assert.throws(() => reportsVersion(assert, 'pyvenv.cfg', cfgSays(v), wrong), /pyvenv\.cfg names uv/);
    assert.throws(() => reportsVersion(assert, 'uvx --version', uvxSays(v), wrong), /uvx --version names uv/);
  }
});

test('NEGATIVE: the previous published uv (0.13.2-1) fails the version rows', () => {
  assert.throws(() => reportsVersion(assert, 'uv --version', uvSays('0.13.2'), '0.13.3'), /uv --version names uv 0\.13\.3/);
  assert.throws(() => reportsVersion(assert, 'pyvenv.cfg', cfgSays('0.13.2'), '0.13.3'), /pyvenv\.cfg names uv 0\.13\.3/);
  assert.throws(() => reportsVersion(assert, 'uvx --version', uvxSays('0.13.2'), '0.13.3'), /uvx --version names uv 0\.13\.3/);
});

test('NEGATIVE: a near-miss version string fails (no prefix match, dots are literal)', () => {
  assert.throws(() => reportsVersion(assert, 'uv --version', uvSays('0.13.30'), '0.13.3'));
  assert.throws(() => reportsVersion(assert, 'uvx --version', uvxSays('0.13.30'), '0.13.3'));
  assert.throws(() => reportsVersion(assert, 'pyvenv.cfg', cfgSays('0.13.30'), '0.13.3'));
  assert.throws(() => reportsVersion(assert, 'uv --version', uvSays('0x13x3'), '0.13.3'));
  assert.throws(() => reportsVersion(assert, 'uv --version', 'uv 0.13.3 (aarch64-apple-darwin)\n', '0.13.3'));
});

test('NEGATIVE: a recipe with no X.Y.Z version, or an unknown row, fails', () => {
  assert.throws(() => recipeVersion(recipe.replace(/^version: ".*"$/m, 'version: "latest"')), /recipe\.yaml names no X\.Y\.Z version/);
  assert.throws(() => recipeVersion('name: wasi-uv\n'), /recipe\.yaml names no X\.Y\.Z version/);
  assert.throws(() => reportsVersion(assert, 'uv self version', 'uv 0.13.3\n', '0.13.3'), /no version pattern for uv self version/);
});

test('olderThan compares X.Y.Z numerically', () => {
  assert.equal(olderThan('0.13.3', '0.13.5'), true);
  assert.equal(olderThan('0.13.5', '0.13.5'), false);
  assert.equal(olderThan('0.13.10', '0.13.5'), false);
  assert.equal(olderThan('0.9.9', '0.13.0'), true);
  assert.equal(olderThan('1.0.0', '0.99.99'), false);
});

test('export: uv 0.13.3 and 0.13.4 export the spurious leaf-c; 0.13.2 and 0.13.5 on omit it (homescoop#1920)', () => {
  assert.equal(exportsSpurious('0.13.2'), false);
  assert.equal(exportsSpurious('0.13.3'), true);
  assert.equal(exportsSpurious('0.13.4'), true);
  assert.equal(exportsSpurious(FIXED_IN), false);
  assert.equal(exportsSpurious('0.13.6'), false);
  assert.equal(expectedExport('0.13.2'), EXPORTED_BY_0_13_2);
  assert.equal(expectedExport('0.13.3'), EXPORTED_BY_0_13_3);
  assert.equal(expectedExport('0.13.6'), EXPORTED_BY_0_13_2);
  assert.ok(EXPORTED_BY_0_13_3.includes(`${SPURIOUS}\n`));
  assert.match(COMMAND, /^uv export --extra feature --frozen /);
});

test("export: uv 0.13.3's output passes the row at recipe.yaml's version", () => {
  const v = recipeVersion();
  const want = exportsSpurious(v) ? EXPORTED_BY_0_13_3 : EXPORTED_BY_0_13_2;
  assert.match(checkExport(assert, ran(want), v), exportsSpurious(v) ? /homescoop#1920/ : /exports no leaf-c/);
});

test('NEGATIVE: the previous published uv (0.13.2-1) fails the export row at 0.13.3', () => {
  assert.throws(() => checkExport(assert, ran(EXPORTED_BY_0_13_2), '0.13.3'), /on uv 0\.13\.3 exports leaf-c==1\.0\.0 ; sys_platform != 'linux'/);
});

test("NEGATIVE: once upstream's fix is in (0.13.5), the spurious leaf-c fails the export row", () => {
  assert.throws(() => checkExport(assert, ran(EXPORTED_BY_0_13_3), FIXED_IN), /exports no leaf-c/);
  checkExport(assert, ran(EXPORTED_BY_0_13_2), FIXED_IN);
});

test("NEGATIVE: the previous published uv (0.13.4-1) fails the export row at recipe.yaml's version", () => {
  assert.throws(() => checkExport(assert, ran(EXPORTED_BY_0_13_3), recipeVersion()), /exports no leaf-c/);
});

test('NEGATIVE: a failing or crashing export fails the row', () => {
  assert.throws(() => checkExport(assert, ran(EXPORTED_BY_0_13_3, 2, 'error: Unable to find lockfile'), '0.13.3'), /rc=2/);
  assert.throws(() => checkExport(assert, ran('', 134, "thread 'main' panicked at crates/uv-lock"), '0.13.3'), /not a crash/);
  assert.throws(() => checkExport(assert, ran(EXPORTED_BY_0_13_3.replace('leaf-b==1.0.0\n', ''), 0), '0.13.3'));
});

const crateVersions = () => readdirSync(new URL('crates/', dir))
  .filter((f) => f.endsWith('.patch'))
  .map((f) => /^(.+)-(\d+\.\d+\.\d+)\.patch$/.exec(f).slice(1));
const firstPatch = readFileSync(new URL('0001-wasi-build-uv-for-wasm32-wasip1-threads.patch', dir), 'utf8');
const certMeta = JSON.parse(source('meta.json'));

function checkCrateRefresh (crates, patch, meta) {
  for (const [name, version] of crates) {
    assert.ok(patch.includes(`+${name} = { path = "homescoop-crates/${name}-${version}" }`), `0001's [patch.crates-io] names ${name} ${version}`);
    assert.ok(patch.includes(` name = "${name}"\n version = "${version}"\n-source`), `0001's Cargo.lock hunk names ${name} ${version}`);
    assert.ok(`crates/${name}-${version}.patch` in meta.patches, `cert/meta.json lists ${name} ${version}`);
  }
}

test('every crates/*.patch version matches 0001 and cert/meta.json', () => {
  assert.equal(crateVersions().length, 8);
  checkCrateRefresh(crateVersions(), firstPatch, certMeta);
});

test('NEGATIVE: a half-done crate refresh fails', () => {
  const crate = [['cargo-util', '0.2.32']];
  const stale = (text) => text.replaceAll('0.2.32', '0.2.31');
  assert.throws(() => checkCrateRefresh(crate, stale(firstPatch), certMeta), /0001's \[patch\.crates-io\] names cargo-util 0\.2\.32/);
  const pathOnly = firstPatch.replace(' name = "cargo-util"\n version = "0.2.32"', ' name = "cargo-util"\n version = "0.2.31"');
  assert.throws(() => checkCrateRefresh(crate, pathOnly, certMeta), /0001's Cargo\.lock hunk names cargo-util 0\.2\.32/);
  assert.throws(() => checkCrateRefresh(crate, firstPatch, JSON.parse(stale(JSON.stringify(certMeta)))), /cert\/meta\.json lists cargo-util 0\.2\.32/);
});

const UV_LOCK_WASIX = /"uv-workspace-commands",\n "walkdir",\n\+ "wasix-command",\n "which",\n "wiremock",/;

function checkUvLockOmitsWasix (patch) {
  assert.doesNotMatch(patch, UV_LOCK_WASIX, "0001 must not add wasix-command to the uv package's Cargo.lock deps (crates/uv has no wasix-command; cargo --locked then fails)");
}

test("0001's Cargo.lock does not add wasix-command to the uv package", () => {
  checkUvLockOmitsWasix(firstPatch);
});

test('NEGATIVE: a 0001 that adds wasix-command to the uv package lock entry fails', () => {
  const bad = `${firstPatch}\n@@\n "uv-workspace-commands",\n "walkdir",\n+ "wasix-command",\n "which",\n "wiremock",\n`;
  assert.throws(() => checkUvLockOmitsWasix(bad), /must not add wasix-command to the uv package/);
});

test("timeout.mjs logs the timeout it causes on purpose as expected, not as a 'wasi-uv: FAIL' line", async () => {
  const { expected } = await import('../../packages/wasi-uv/cert/timeout.mjs');
  const line = "wasi-uv: FAIL uv run --no-project python -c 'import time; time.sleep(600)': no exit within 15 s (detached, polled; 16 s)";
  assert.doesNotMatch(expected(line), /^wasi-uv: FAIL/);
  assert.match(expected(line), /^timeout: expected, the row hangs uv on purpose: uv run .*: no exit within 15 s \(detached, polled; 16 s\)$/);
  const start = 'wasi-uv: /home/t$ uv run --no-project python (detached, polled, budget 15 s)';
  assert.equal(expected(start), start);
});
