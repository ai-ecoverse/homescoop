import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { repackPeer } from '../browser-cert/compat.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function metas(dir = root) {
  return readdirSync(join(dir, 'packages'))
    .filter((p) => existsSync(join(dir, 'packages', p, 'cert', 'meta.json')))
    .sort()
    .map((p) => ({ pkg: p, meta: JSON.parse(readFileSync(join(dir, 'packages', p, 'cert', 'meta.json'), 'utf8')) }));
}

test('every needsRepack peer in a cert/meta.json is a recipe with repack.from (#600)', () => {
  const bad = [];
  for (const { pkg, meta } of metas()) {
    for (const peer of meta.needsRepack || []) {
      let plan;
      try {
        plan = repackPeer(peer);
      } catch (err) {
        bad.push(`packages/${pkg}/cert/meta.json: ${err.message}`);
        continue;
      }
      if (plan.kind !== 'repack') {
        bad.push(`packages/${pkg}/cert/meta.json: needsRepack ${peer} has no repack.from (it builds from source); list ${plan.spec} under needsInstall instead`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('repackPeer: a repack recipe repacks, one built from source installs its published version, an unknown one fails', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'homescoop-repack-peer-')));
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    cpSync(join(root, 'scripts', 'read-recipe.mjs'), join(dir, 'scripts', 'read-recipe.mjs'));
    for (const [name, recipe, version] of [
      ['py-numpy', 'name: py-numpy\nbuilder: host\nversion: "2.3.2"\nrepack:\n  from: "2.3.2-8"\n', '2.3.2-9'],
      ['py-kiwisolver', 'name: py-kiwisolver\nbuilder: host\nversion: "1.5.1"\n', '1.5.1-7'],
    ]) {
      mkdirSync(join(dir, 'packages', name, 'package'), { recursive: true });
      writeFileSync(join(dir, 'packages', name, 'recipe.yaml'), recipe);
      writeFileSync(join(dir, 'packages', name, 'package', 'package.json'), JSON.stringify({ name: `@ai-ecoverse/${name}`, version }));
    }
    assert.deepEqual(repackPeer('py-numpy', { dir }), { kind: 'repack' });
    assert.deepEqual(repackPeer('py-kiwisolver', { dir }), { kind: 'published', spec: '@ai-ecoverse/py-kiwisolver@1.5.1-7' });
    assert.throws(() => repackPeer('py-nothing', { dir }), /needsRepack py-nothing: no recipe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
