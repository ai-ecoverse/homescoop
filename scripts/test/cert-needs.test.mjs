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

function unmountedInstalls(meta) {
  const needs = new Set(meta.needs || []);
  return (meta.needsInstall || []).map((spec) => spec.replace(/(.)@[^@]*$/, '$1')).filter((name) => !needs.has(name));
}

test('every needsInstall package of a py-* cert is in needs, so run.mjs mounts it (#1190)', () => {
  const bad = [];
  for (const { pkg, meta } of metas()) {
    if (!pkg.startsWith('py-')) continue;
    for (const name of unmountedInstalls(meta)) bad.push(`packages/${pkg}/cert/meta.json: ${name} is in needsInstall but not in needs`);
  }
  assert.deepEqual(bad, []);
});

test('unmountedInstalls flags py-pandas3.15 3.0.6-1 as cert-review saw it on #1188: py-six installed, not mounted (#1190)', () => {
  const seen = {
    needs: ['@ai-ecoverse/wasix-python', '@ai-ecoverse/py-numpy', '@ai-ecoverse/py-python-dateutil', '@ai-ecoverse/py-tzdata'],
    needsInstall: ['@ai-ecoverse/wasix-python@3.15.0-1', '@ai-ecoverse/py-numpy@2.5.4-1', '@ai-ecoverse/py-python-dateutil@2.9.0-post0.3', '@ai-ecoverse/py-tzdata@2026.4.0-3', '@ai-ecoverse/py-six@1.17.0-3'],
  };
  assert.deepEqual(unmountedInstalls(seen), ['@ai-ecoverse/py-six']);
  assert.deepEqual(unmountedInstalls({ ...seen, needs: [...seen.needs, '@ai-ecoverse/py-six'] }), []);
  assert.deepEqual(unmountedInstalls({ needs: ['@ai-ecoverse/wasm-bash'], needsInstall: ['@ai-ecoverse/wasm-bash'] }), []);
});

function sidemodsPure(src) {
  const pkgs = [...src.match(/const PKGS = \[([^\]]*)\]/)[1].matchAll(/'(py-[a-z0-9-]+)'/g)].map((m) => m[1]);
  const blocks = new Set([...src.matchAll(/^  '(py-[a-z0-9-]+)': String\.raw`/gm)].map((m) => m[1]));
  return pkgs.filter((p) => !blocks.has(p));
}

function sidemodsGaps(meta, pure) {
  const listed = (list) => new Set((list || []).map((n) => n.replace(/^(@ai-ecoverse\/[^@]+)@.*$/, '$1')));
  const needs = listed(meta.needs);
  const install = listed(meta.needsInstall);
  return pure.flatMap((p) => [
    ...(needs.has(`@ai-ecoverse/${p}`) ? [] : [`needs ${p}`]),
    ...(meta.needsInstall && !install.has(`@ai-ecoverse/${p}`) ? [`needsInstall ${p}`] : []),
  ]);
}

test('a cert that runs wasix-python cert/sidemods.mjs installs every pure py-* its script imports (#1261)', () => {
  const src = readFileSync(join(root, 'packages', 'wasix-python', 'cert', 'sidemods.mjs'), 'utf8');
  const pure = sidemodsPure(src);
  assert.ok(pure.includes('py-pytz') && pure.includes('py-python-dateutil') && pure.includes('py-tzdata'), `sidemods.mjs pure imports: ${pure.join(' ')}`);
  const users = readdirSync(join(root, 'packages')).filter((p) => {
    const dir = join(root, 'packages', p, 'cert');
    return existsSync(join(dir, 'sidemods.mjs')) && (p === 'wasix-python' || /from '\.\.\/\.\.\/wasix-python\/cert\/sidemods\.mjs'/.test(readFileSync(join(dir, 'sidemods.mjs'), 'utf8')));
  });
  assert.ok(users.includes('py-matplotlib'), `users of sidemods.mjs: ${users.join(' ')}`);
  const bad = users.flatMap((p) => sidemodsGaps(JSON.parse(readFileSync(join(root, 'packages', p, 'cert', 'meta.json'), 'utf8')), pure).map((g) => `packages/${p}/cert/meta.json: ${g}`));
  assert.deepEqual(bad, []);
  const mpl = JSON.parse(readFileSync(join(root, 'packages', 'py-matplotlib', 'cert', 'meta.json'), 'utf8'));
  const withoutPytz = { ...mpl, needs: mpl.needs.filter((n) => n !== '@ai-ecoverse/py-pytz'), needsInstall: mpl.needsInstall.filter((n) => !n.startsWith('@ai-ecoverse/py-pytz@')) };
  assert.deepEqual(sidemodsGaps(withoutPytz, pure), ['needs py-pytz', 'needsInstall py-pytz']);
});
