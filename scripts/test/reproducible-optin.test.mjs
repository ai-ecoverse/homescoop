import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ALLOW = new Map([]);
const pending = JSON.parse(readFileSync(join(root, 'scripts/reproducible-pending.json'), 'utf8'));

function recipe(p) {
  const r = spawnSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), p, '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || `read-recipe.mjs ${p} failed`);
  return JSON.parse(r.stdout);
}

// true, or a map (path: package/<file> and/or same_path: <issue>, #668);
// classify-touched-packages.mjs validates the map.
const optedIn = (v) => v === 'true' || v === true || (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0);

const packages = readdirSync(join(root, 'packages')).filter((p) => existsSync(join(root, 'packages', p, 'recipe.yaml'))).sort();
const recipes = new Map(packages.map((p) => [p, recipe(p)]));
const built = packages.filter((p) => {
  const r = recipes.get(p);
  const repack = r.repack && typeof r.repack === 'object' && r.repack.from;
  return r.builder === 'host' && !repack;
});

const optedOut = (v) => v === 'false' || v === false;

test('every built recipe is rebuilt and compared: reproducible: is on unless it says false, with an issue (homescoop#808)', () => {
  const out = built.filter((p) => optedOut(recipes.get(p).reproducible) && !ALLOW.has(p));
  assert.deepEqual(out, [], `reproducible: false needs an issue in ALLOW: ${out.join(', ')}`);
});

test('classify rebuilds a built recipe that says nothing, and not a repack or one that says false', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts/classify-touched-packages.mjs'), '--all'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const { rebuild } = JSON.parse(r.stdout);
  const want = built.filter((p) => !optedOut(recipes.get(p).reproducible) && (optedIn(recipes.get(p).reproducible) || !Object.hasOwn(pending, p)));
  assert.deepEqual(rebuild.filter((p) => Object.hasOwn(pending, p) && !optedIn(recipes.get(p).reproducible)), [], 'pending recipes stay out of rebuild');
  assert.deepEqual(want.filter((p) => !rebuild.includes(p)), [], 'built recipes classify leaves out of rebuild');
});

test('reproducible-pending.json lists built recipes that say nothing yet, each with its issue (#808)', () => {
  const stale = Object.keys(pending).filter((p) => !built.includes(p) || recipes.get(p).reproducible !== undefined && recipes.get(p).reproducible !== null);
  assert.deepEqual(stale, [], `drop from scripts/reproducible-pending.json (set reproducible:, repacked, retired or gone): ${stale.join(', ')}`);
  assert.deepEqual(Object.keys(pending), Object.keys(pending).slice().sort(), 'sorted');
  for (const [p, n] of Object.entries(pending)) assert.ok(Number.isInteger(n) && n > 0, `${p}: issue number`);
});

test('the allowlist has no stale entries', () => {
  const stale = [...ALLOW.keys()].filter((p) => !built.includes(p) || !optedOut(recipes.get(p).reproducible));
  assert.deepEqual(stale, [], `drop from ALLOW (opted in, repacked, retired or gone): ${stale.join(', ')}`);
  for (const [p, n] of ALLOW) assert.ok(Number.isInteger(n) && n > 0, `${p}: issue number`);
});

test('wasi-uv (#675) and py-kiwisolver (#569) opt in', () => {
  for (const p of ['wasi-uv', 'py-kiwisolver']) assert.ok(optedIn(recipes.get(p).reproducible), p);
});

test('qpdf (homescoop#1354) and procps (homescoop#1852) are off the pending list and ladder-build rebuilds and compares them (#808)', () => {
  const r = spawnSync(process.execPath, [join(root, 'scripts/classify-touched-packages.mjs'), '--all'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const { rebuild } = JSON.parse(r.stdout);
  for (const p of ['qpdf', 'procps']) {
    assert.ok(!Object.hasOwn(pending, p), `${p} is still in scripts/reproducible-pending.json`);
    assert.ok(rebuild.includes(p), `classify leaves ${p} out of rebuild`);
  }
});
