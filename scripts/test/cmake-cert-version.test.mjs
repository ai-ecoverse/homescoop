import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { recipeVersion, reportsVersion, seriesOf } from '../../packages/cmake/cert/lib/version.mjs';

const dir = new URL('../../packages/cmake/', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package/package.json', dir), 'utf8'));
const recipe = readFileSync(new URL('recipe.yaml', dir), 'utf8');
const certDir = new URL('cert/', dir);
const specs = readdirSync(certDir).filter((f) => f.endsWith('.mjs'));
const source = (f) => readFileSync(new URL(f, certDir), 'utf8');

const cmakeSays = (v) => `cmake version ${v}\nCMake suite maintained and supported by Kitware (kitware.com/cmake).\n`;

test('recipe.yaml, package.json and the spec agree on the upstream', () => {
  assert.equal(recipeVersion(), pkg.homescoop.upstream);
  assert.equal(recipeVersion(recipe), pkg.homescoop.upstream);
  assert.match(pkg.version, new RegExp(`^${pkg.homescoop.upstream.replaceAll('.', '\\.')}-\\d+$`));
  assert.equal(seriesOf(recipeVersion()), recipeVersion().replace(/\.\d+$/, ''));
  assert.match(pkg.slicc.env.CMAKE_ROOT, new RegExp(`/share/cmake-${seriesOf(recipeVersion()).replaceAll('.', '\\.')}$`));
});

test('no cert spec pins a cmake version in an assertion, so a Renovate bump needs no cert edit', () => {
  for (const f of specs) {
    assert.doesNotMatch(source(f), /cmake version \d+\\\.\d+/, `${f} pins a cmake version`);
    assert.doesNotMatch(source(f), /\/\^cmake version /, `${f} pins a cmake --version regex`);
  }
  const cmake = source('cmake.mjs');
  const v = recipeVersion();
  assert.ok(!cmake.includes(v), `cmake.mjs names ${v}`);
  assert.ok(!cmake.includes(v.replaceAll('.', '\\.')), `cmake.mjs names ${v} as a regex`);
  assert.ok(cmake.includes('reportsVersion(assert,'), 'cmake.mjs checks --version against recipe.yaml');
  assert.ok(cmake.includes('recipeVersion()'), 'cmake.mjs reads recipe.yaml');
  assert.ok(cmake.includes('seriesOf(want)'), 'cmake.mjs derives CMAKE_ROOT series from recipe.yaml');
});

test("cmake --version that names recipe.yaml's version passes", () => {
  const v = recipeVersion();
  reportsVersion(assert, cmakeSays(v));
  reportsVersion(assert, `cmake version ${v}\n`, v);
});

test('a future upstream passes with no spec change', () => {
  const v = recipeVersion(recipe.replace(/^version: ".*"$/m, 'version: "4.5.0"'));
  assert.equal(v, '4.5.0');
  assert.equal(seriesOf(v), '4.5');
  reportsVersion(assert, cmakeSays(v), v);
});

test('NEGATIVE: a deliberately wrong expected version fails', () => {
  const v = recipeVersion();
  for (const wrong of ['4.4.3', '4.4.50', '4.4.5.0', '5.4.5']) {
    assert.throws(() => reportsVersion(assert, cmakeSays(v), wrong), new RegExp(`cmake --version names cmake version ${wrong.replaceAll('.', '\\.')}, recipe\\.yaml's version`));
  }
});

test('NEGATIVE: the previously published cmake (4.4.3-14) fails the version row at recipe.yaml', () => {
  const want = recipeVersion();
  assert.notEqual(want, '4.4.3');
  assert.throws(
    () => reportsVersion(assert, cmakeSays('4.4.3'), want),
    new RegExp(`cmake --version names cmake version ${want.replaceAll('.', '\\.')}`),
  );
});

test('NEGATIVE: a near-miss version string fails (no prefix match, dots are literal)', () => {
  assert.throws(() => reportsVersion(assert, cmakeSays('4.4.50'), '4.4.5'));
  assert.throws(() => reportsVersion(assert, cmakeSays('4x4x5'), '4.4.5'));
  assert.throws(() => reportsVersion(assert, 'CMake Version 4.4.5\n', '4.4.5'));
});

test('NEGATIVE: a recipe with no X.Y.Z version, or a bad series, fails', () => {
  assert.throws(() => recipeVersion(recipe.replace(/^version: ".*"$/m, 'version: "latest"')), /recipe\.yaml names no X\.Y\.Z version/);
  assert.throws(() => recipeVersion('name: cmake\n'), /recipe\.yaml names no X\.Y\.Z version/);
  assert.throws(() => seriesOf('4.4'), /is not X\.Y\.Z/);
  assert.throws(() => seriesOf('latest'), /is not X\.Y\.Z/);
});
