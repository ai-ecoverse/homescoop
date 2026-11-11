import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { recipeVersion, reportsVersion } from '../../packages/rsync/cert/lib/version.mjs';

const dir = new URL('../../packages/rsync/', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package/package.json', dir), 'utf8'));
const recipe = readFileSync(new URL('recipe.yaml', dir), 'utf8');
const certDir = new URL('cert/', dir);
const specs = readdirSync(certDir).filter((f) => f.endsWith('.mjs'));
const source = (f) => readFileSync(new URL(f, certDir), 'utf8');

const rsyncSays = (v) => `rsync  version ${v}  protocol version 33\nCopyright (C) 1996-2026 by Andrew Tridgell, Wayne Davison, and others.\n`;

test('recipe.yaml, package.json and the spec agree on the upstream', () => {
  assert.equal(recipeVersion(), pkg.homescoop.upstream);
  assert.equal(recipeVersion(recipe), pkg.homescoop.upstream);
  assert.match(pkg.version, new RegExp(`^${pkg.homescoop.upstream.replaceAll('.', '\\.')}-\\d+$`));
});

test('no cert spec pins an rsync version in an assertion, so a Renovate bump needs no cert edit', () => {
  for (const f of specs) {
    assert.doesNotMatch(source(f), /rsync \{2\}version \d+\\\.\d+/, `${f} pins an rsync version`);
    assert.doesNotMatch(source(f), /\/\^rsync \{2\}version /, `${f} pins an rsync --version regex`);
  }
  const checklist = source('checklist.mjs');
  const v = recipeVersion();
  assert.ok(!checklist.includes(v), `checklist.mjs names ${v}`);
  assert.ok(!checklist.includes(v.replaceAll('.', '\\.')), `checklist.mjs names ${v} as a regex`);
  assert.ok(checklist.includes('reportsVersion(assert,'), 'checklist.mjs checks --version against recipe.yaml');
  assert.ok(checklist.includes('recipeVersion()'), 'checklist.mjs reads recipe.yaml');
});

test("rsync --version that names recipe.yaml's version passes", () => {
  const v = recipeVersion();
  reportsVersion(assert, rsyncSays(v));
  reportsVersion(assert, `rsync  version ${v}  protocol version 33\n`, v);
});

test('a future upstream passes with no spec change', () => {
  const v = recipeVersion(recipe.replace(/^version: ".*"$/m, 'version: "3.6.0"'));
  assert.equal(v, '3.6.0');
  reportsVersion(assert, rsyncSays(v), v);
});

test('NEGATIVE: a deliberately wrong expected version fails', () => {
  const v = recipeVersion();
  for (const wrong of ['3.5.1', '3.5.20', '3.5.2.0', '4.5.2']) {
    assert.throws(() => reportsVersion(assert, rsyncSays(v), wrong), new RegExp(`rsync --version names rsync version ${wrong.replaceAll('.', '\\.')}, recipe\\.yaml's version`));
  }
});

test('NEGATIVE: the previously published rsync (3.5.1-7) fails the version row at recipe.yaml', () => {
  const want = recipeVersion();
  assert.notEqual(want, '3.5.1');
  assert.throws(
    () => reportsVersion(assert, rsyncSays('3.5.1'), want),
    new RegExp(`rsync --version names rsync version ${want.replaceAll('.', '\\.')}`),
  );
});

test('NEGATIVE: a near-miss version string fails (no prefix match, dots are literal)', () => {
  assert.throws(() => reportsVersion(assert, rsyncSays('3.5.20'), '3.5.2'));
  assert.throws(() => reportsVersion(assert, rsyncSays('3x5x2'), '3.5.2'));
  assert.throws(() => reportsVersion(assert, 'Rsync  version 3.5.2  protocol version 33\n', '3.5.2'));
  assert.throws(() => reportsVersion(assert, 'rsync  version 3.5.2  protocol version 32\n', '3.5.2'));
});

test('NEGATIVE: a recipe with no X.Y.Z version fails', () => {
  assert.throws(() => recipeVersion(recipe.replace(/^version: ".*"$/m, 'version: "latest"')), /recipe\.yaml names no X\.Y\.Z version/);
  assert.throws(() => recipeVersion('name: rsync\n'), /recipe\.yaml names no X\.Y\.Z version/);
});
