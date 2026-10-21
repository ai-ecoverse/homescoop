import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');

const recipes = {
  held: 'name: held\nbuilder: host\nrunner: pool\n',
  pooled: 'name: pooled\nbuilder: host\nrunner: pool\n',
  hosted: 'name: hosted\nbuilder: host\n',
};

function classify(hold) {
  const root = mkdtempSync(join(tmpdir(), 'homescoop-pool-hold-'));
  try {
    mkdirSync(join(root, 'scripts'));
    for (const f of ['list-touched-packages.mjs', 'classify-touched-packages.mjs', 'read-recipe.mjs']) {
      copyFileSync(join(scripts, f), join(root, 'scripts', f));
    }
    for (const [name, recipe] of Object.entries(recipes)) {
      mkdirSync(join(root, 'packages', name), { recursive: true });
      writeFileSync(join(root, 'packages', name, 'recipe.yaml'), recipe);
    }
    if (hold !== undefined) writeFileSync(join(root, 'scripts', 'pool-hold.json'), hold);
    return spawnSync(process.execPath, [join(root, 'scripts/classify-touched-packages.mjs'), '--all'], { cwd: root, encoding: 'utf8' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('pool-hold: a held runner: pool recipe leaves pool, an unheld one stays', () => {
  const r = classify('["held"]\n');
  assert.equal(r.status, 0, r.stderr);
  const c = JSON.parse(r.stdout);
  assert.deepEqual(c.pool, ['pooled']);
  assert.deepEqual(c.host, ['held', 'hosted', 'pooled']);
  assert.deepEqual(c.rebuild, ['held', 'hosted', 'pooled']);
});

test('pool-hold: an empty or absent hold file keeps every runner: pool recipe on the pool', () => {
  for (const hold of ['[]\n', undefined]) {
    const r = classify(hold);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).pool, ['held', 'pooled']);
  }
});

test('pool-hold: a malformed hold file, or a name that is not a runner: pool recipe, exits 1', () => {
  for (const [hold, why] of [
    ['{"held": true}\n', /must be a JSON array of package names/],
    ['"held"\n', /must be a JSON array of package names/],
    ['["held", 1]\n', /must be a JSON array of package names/],
    ['["../held"]\n', /must be a JSON array of package names/],
    ['["held",\n', /pool-hold\.json/],
    ['["hosted"]\n', /hosted is not a runner: pool recipe/],
    ['["missing"]\n', /missing is not a runner: pool recipe/],
  ]) {
    const r = classify(hold);
    assert.equal(r.status, 1, `${hold}: ${r.stdout}`);
    assert.match(r.stderr, why);
  }
});

test('pool-hold: the committed list names only runner: pool recipes', () => {
  const list = JSON.parse(readFileSync(join(scripts, 'pool-hold.json'), 'utf8'));
  assert.ok(Array.isArray(list));
  for (const p of list) {
    assert.match(readFileSync(join(scripts, '..', 'packages', p, 'recipe.yaml'), 'utf8'), /^runner: pool$/m, p);
  }
});
