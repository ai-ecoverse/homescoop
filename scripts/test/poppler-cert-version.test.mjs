import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { recipeVersion, reportsVersion } from '../../packages/poppler/cert/lib/version.mjs';

const dir = new URL('../../packages/poppler/', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package/package.json', dir), 'utf8'));
const recipe = readFileSync(new URL('recipe.yaml', dir), 'utf8');
const certDir = new URL('cert/', dir);
const specs = readdirSync(certDir).filter((f) => f.endsWith('.mjs'));
const source = (f) => readFileSync(new URL(f, certDir), 'utf8');

const popplerSays = (util, v) =>
  `${util} version ${v}\nOpenJPEG version 2.5.4\nCopyright 2005-2026 The Poppler Developers - http://poppler.freedesktop.org\n`;

test('recipe.yaml, package.json and the spec agree on the upstream', () => {
  assert.equal(recipeVersion(), pkg.homescoop.upstream);
  assert.equal(recipeVersion(recipe), pkg.homescoop.upstream);
  assert.match(pkg.version, new RegExp(`^${pkg.homescoop.upstream.replaceAll('.', '\\.')}-\\d+$`));
});

test('no cert spec pins a poppler version in an assertion, so a Renovate bump needs no cert edit', () => {
  for (const f of specs) {
    assert.doesNotMatch(source(f), /version \d+\.\d+\.\d+/, `${f} pins a poppler version`);
    assert.doesNotMatch(source(f), /pdftoppm version \d+/, `${f} pins a pdftoppm version`);
  }
  const checklist = source('checklist.mjs');
  const v = recipeVersion();
  assert.ok(!checklist.includes(v), `checklist.mjs names ${v}`);
  assert.ok(!checklist.includes(v.replaceAll('.', '\\.')), `checklist.mjs names ${v} as a regex`);
  assert.ok(checklist.includes('reportsVersion(assert,'), 'checklist.mjs checks -v against recipe.yaml');
  assert.ok(checklist.includes('recipeVersion()'), 'checklist.mjs reads recipe.yaml');
});

test("pdftoppm -v and pdfinfo -v that name recipe.yaml's version on the first stderr line pass", () => {
  const v = recipeVersion();
  reportsVersion(assert, popplerSays('pdftoppm', v), 'pdftoppm');
  reportsVersion(assert, popplerSays('pdfinfo', v), 'pdfinfo');
  reportsVersion(assert, `pdftoppm version ${v}\n`, 'pdftoppm', v);
});

test('a future upstream passes with no spec change', () => {
  const v = recipeVersion(recipe.replace(/^version: ".*"$/m, 'version: "26.12.0"'));
  assert.equal(v, '26.12.0');
  reportsVersion(assert, popplerSays('pdftoppm', v), 'pdftoppm', v);
  reportsVersion(assert, popplerSays('pdfinfo', v), 'pdfinfo', v);
});

test('NEGATIVE: a deliberately wrong expected version fails', () => {
  const v = recipeVersion();
  for (const wrong of ['26.10.0', '26.11.00', '26.11.0.0', '27.11.0']) {
    assert.throws(
      () => reportsVersion(assert, popplerSays('pdftoppm', v), 'pdftoppm', wrong),
      /pdftoppm reports Poppler on the first stderr line, recipe\.yaml's version/,
    );
  }
});

test('NEGATIVE: the previously published poppler (26.10.0-9) fails the version row at recipe.yaml', () => {
  const want = recipeVersion();
  assert.notEqual(want, '26.10.0');
  assert.throws(
    () => reportsVersion(assert, popplerSays('pdftoppm', '26.10.0'), 'pdftoppm', want),
    /pdftoppm reports Poppler on the first stderr line, recipe\.yaml's version/,
  );
  assert.throws(
    () => reportsVersion(assert, popplerSays('pdfinfo', '26.10.0'), 'pdfinfo', want),
    /pdfinfo reports Poppler on the first stderr line, recipe\.yaml's version/,
  );
});

test('NEGATIVE: a near-miss version string fails (exact first line, dots are literal)', () => {
  assert.throws(() => reportsVersion(assert, popplerSays('pdftoppm', '26.11.00'), 'pdftoppm', '26.11.0'));
  assert.throws(() => reportsVersion(assert, popplerSays('pdftoppm', '26x11x0'), 'pdftoppm', '26.11.0'));
  assert.throws(() => reportsVersion(assert, 'Pdftoppm version 26.11.0\n', 'pdftoppm', '26.11.0'));
  assert.throws(() => reportsVersion(assert, 'OpenJPEG version 2.5.4\npdftoppm version 26.11.0\n', 'pdftoppm', '26.11.0'));
});

test('NEGATIVE: a recipe with no X.Y.Z version fails', () => {
  assert.throws(() => recipeVersion(recipe.replace(/^version: ".*"$/m, 'version: "latest"')), /recipe\.yaml names no X\.Y\.Z version/);
  assert.throws(() => recipeVersion('name: poppler\n'), /recipe\.yaml names no X\.Y\.Z version/);
});
