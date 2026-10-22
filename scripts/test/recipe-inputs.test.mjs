import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { globRegExp } from '../list-touched-packages.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const packages = readdirSync(join(root, 'packages')).filter((p) => existsSync(join(root, 'packages', p, 'recipe.yaml'))).sort();

function inputs(p) {
  if (!/^inputs:/m.test(readFileSync(join(root, 'packages', p, 'recipe.yaml'), 'utf8'))) return [];
  const r = spawnSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), p, '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || `read-recipe.mjs ${p} failed`);
  return JSON.parse(r.stdout).inputs || [];
}

function files(dir) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path);
      else out.push(path);
    }
  };
  if (existsSync(join(root, dir)) && statSync(join(root, dir)).isDirectory()) walk(dir);
  return out;
}

function matches(glob) {
  if (!/[*?]/.test(glob)) return existsSync(join(root, glob));
  const base = glob.slice(0, glob.search(/[*?]/)).replace(/[^/]*$/, '').replace(/\/$/, '');
  const re = globRegExp(glob);
  return files(base).some((f) => re.test(f));
}

test('every recipe input names a file that exists, so a deleted input fails here and not in the build (homescoop#1625)', () => {
  const missing = [];
  for (const p of packages) for (const g of inputs(p)) if (!matches(g)) missing.push(`packages/${p}/recipe.yaml: ${g}`);
  assert.deepEqual(missing, []);
});

test('a recipe links the shared shims/slicc/slicc-env.js, never a package-local copy (homescoop#1625)', () => {
  const local = [];
  for (const p of packages) {
    const dir = join(root, 'packages', p);
    for (const f of readdirSync(dir).filter((n) => n === 'recipe.yaml' || /\.(?:sh|bash)$/.test(n))) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const m of text.matchAll(/packages\/[A-Za-z0-9._-]+\/(?:[^\s"']*\/)?slicc-env\.js/g)) local.push(`packages/${p}/${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(local, []);
});
