import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { recipeVersion, reportsVersion, versionStdout } from '../../packages/wasi-yq/cert/lib/version.mjs';

const dir = new URL('../../packages/wasi-yq/', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package/package.json', dir), 'utf8'));
const recipe = readFileSync(new URL('recipe.yaml', dir), 'utf8');
const certDir = new URL('cert/', dir);
const specs = readdirSync(certDir).filter((f) => f.endsWith('.mjs'));
const source = (f) => readFileSync(new URL(f, certDir), 'utf8');

test('recipe.yaml, package.json and the spec agree on the upstream', () => {
  assert.equal(recipeVersion(), pkg.homescoop.upstream);
  assert.equal(recipeVersion(recipe), pkg.homescoop.upstream);
  assert.match(pkg.version, new RegExp(`^${pkg.homescoop.upstream.replaceAll('.', '\\.')}-\\d+$`));
});

test('no cert spec pins a yq version in an assertion, so a Renovate bump needs no cert edit', () => {
  for (const f of specs) {
    assert.doesNotMatch(source(f), /version v4\\\.\d+/, `${f} pins a yq version`);
    assert.doesNotMatch(source(f), /yq \(https:\/\/github\.com\/mikefarah\/yq\/\) version v\d/, `${f} pins yq --version text`);
  }
  const checklist = source('checklist.mjs');
  const v = recipeVersion();
  assert.ok(!checklist.includes(v), `checklist.mjs names ${v}`);
  assert.ok(!checklist.includes(`v${v}`), `checklist.mjs names v${v}`);
  assert.ok(checklist.includes('reportsVersion(assert,'), 'checklist.mjs checks --version against recipe.yaml');
  assert.ok(checklist.includes('recipeVersion()'), 'checklist.mjs reads recipe.yaml');
  const notices = source('notices.mjs');
  assert.ok(notices.includes('recipeVersion()'), 'notices.mjs reads recipe.yaml for the intro line');
  assert.ok(!notices.includes(`yq ${v}`), `notices.mjs does not hard-code yq ${v}`);
});

test("yq --version that names recipe.yaml's version passes", () => {
  const v = recipeVersion();
  reportsVersion(assert, versionStdout(v));
  reportsVersion(assert, versionStdout(v), v);
});

test('a future upstream passes with no spec change', () => {
  const v = recipeVersion(recipe.replace(/^version: ".*"$/m, 'version: "4.55.0"'));
  assert.equal(v, '4.55.0');
  reportsVersion(assert, versionStdout(v), v);
});

test('NEGATIVE: a deliberately wrong expected version fails', () => {
  const v = recipeVersion();
  for (const wrong of ['4.54.1', '4.54.20', '4.54.2.0', '5.54.2']) {
    assert.throws(
      () => reportsVersion(assert, versionStdout(v), wrong),
      new RegExp(`yq --version names yq version v${wrong.replaceAll('.', '\\.')}, recipe\\.yaml's version`),
    );
  }
});

test('NEGATIVE: the previously published wasi-yq (4.54.1-1) fails the version row at recipe.yaml', () => {
  const want = recipeVersion();
  assert.notEqual(want, '4.54.1');
  assert.throws(
    () => reportsVersion(assert, versionStdout('4.54.1'), want),
    new RegExp(`yq --version names yq version v${want.replaceAll('.', '\\.')}`),
  );
});

test('NEGATIVE: a near-miss version string fails (no prefix match, dots are literal)', () => {
  assert.throws(() => reportsVersion(assert, versionStdout('4.54.20'), '4.54.2'));
  assert.throws(() => reportsVersion(assert, versionStdout('4x54x2'), '4.54.2'));
  assert.throws(() => reportsVersion(assert, 'Yq (https://github.com/mikefarah/yq/) version v4.54.2\n', '4.54.2'));
});

test('NEGATIVE: a recipe with no X.Y.Z version fails', () => {
  assert.throws(() => recipeVersion(recipe.replace(/^version: ".*"$/m, 'version: "latest"')), /recipe\.yaml names no X\.Y\.Z version/);
  assert.throws(() => recipeVersion('name: wasi-yq\n'), /recipe\.yaml names no X\.Y\.Z version/);
});
