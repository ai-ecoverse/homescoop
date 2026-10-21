import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { enginesFloor, enginesRefusal, useBaseCerts } from '../browser-cert/compat.mjs';

function repo(t) {
  const dir = mkdtempSync(join(tmpdir(), 'compat-certbase-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  git('init', '-q', '-b', 'main');
  return { dir, git, put };
}

test('a package whose cert/ the change touches runs its published tarballs with the base cert/; a new cert/ is skipped; others are untouched', (t) => {
  const r = repo(t);
  r.put('packages/pnpm/cert/install.mjs', 'export default async () => {};\n');
  r.put('packages/pnpm/cert/meta.json', JSON.stringify({ users: 'enforce' }));
  r.put('packages/zip/cert/roundtrip.mjs', 'export default async () => {};\n');
  r.git('add', '--', 'packages/pnpm/cert/install.mjs', 'packages/pnpm/cert/meta.json', 'packages/zip/cert/roundtrip.mjs');
  r.git('commit', '-qm', 'base');
  const base = r.git('rev-parse', 'HEAD');
  r.put('packages/pnpm/cert/update-readers.mjs', 'export default async () => {};\n');
  r.put('packages/fresh/cert/a.mjs', 'export default async () => {};\n');
  r.git('add', '--', 'packages/pnpm/cert/update-readers.mjs', 'packages/fresh/cert/a.mjs');
  r.git('commit', '-qm', 'head');
  const all = [
    { dir: 'pnpm', specs: ['install.mjs', 'update-readers.mjs'], meta: { users: 'enforce' }, skip: null },
    { dir: 'zip', specs: ['roundtrip.mjs'], meta: {}, skip: null },
    { dir: 'fresh', specs: ['a.mjs'], meta: {}, skip: null },
  ];
  const out = mkdtempSync(join(tmpdir(), 'compat-certbase-out-'));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const notes = useBaseCerts(all, base, out, { cwd: r.dir });
  assert.deepEqual(all[0].specs, ['install.mjs'], 'the base cert/ has no update-readers.mjs');
  assert.equal(all[0].cert, 'base-cert/packages/pnpm/cert');
  assert.equal(all[0].certFrom, base);
  assert.equal(all[0].meta.users, 'enforce');
  assert.equal(readFileSync(join(out, all[0].cert, 'install.mjs'), 'utf8'), 'export default async () => {};\n');
  assert.deepEqual(all[1], { dir: 'zip', specs: ['roundtrip.mjs'], meta: {}, skip: null }, 'an untouched package keeps the head cert/');
  assert.match(all[2].skip, /cert\/ is new in this change/);
  assert.equal(notes.length, 2);
  assert.deepEqual(useBaseCerts(structuredClone(all), r.git('rev-parse', 'HEAD'), out, { cwd: r.dir }), [], 'no base cert/ when the base is the head');
});

test("a reference run that fails only on an engines refusal is can't judge, not a fail shape", () => {
  const refused = {
    status: 'fail',
    specs: [{ spec: 'update-readers.mjs', status: 'fail', cases: { pass: [], fail: [{ id: 'x:97', message: 'the mv baseline: rc=126\nbash: @ai-ecoverse/wasm-bash@5.3.0-21 needs slicc-kernel >=1.130.2; this kernel is 1.129.0\n\n126 !== 0' }] } }],
  };
  assert.equal(enginesRefusal(refused), '@ai-ecoverse/wasm-bash@5.3.0-21 needs slicc-kernel >=1.130.2, the reference is 1.129.0');
  const real = { status: 'fail', specs: [{ spec: 'update-readers.mjs', status: 'fail', cases: { pass: [], fail: [{ id: 'x:97', message: 'big half there 24' }] } }] };
  assert.equal(enginesRefusal(real), null);
  assert.equal(enginesRefusal({ status: 'fail', specs: [], error: 'bash: @ai-ecoverse/wasm-bash@5.3.0-21 needs slicc-kernel >=1.130.2; this kernel is 1.122.0' }), '@ai-ecoverse/wasm-bash@5.3.0-21 needs slicc-kernel >=1.130.2, the reference is 1.122.0');
});

test('the engines floor is the highest >= of the tarball and its installed peers', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'compat-floor-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pkg = join(dir, 'p', 'package');
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@ai-ecoverse/wasi-pnpm', version: '12.9.1-17', engines: { 'slicc-kernel': '>=1.110.0' } }));
  assert.equal(spawnSync('tar', ['-czf', join(dir, 'p.tgz'), '-C', join(dir, 'p'), 'package']).status, 0);
  const nm = join(dir, 'nm');
  for (const [d, engines] of [['wasm-bash', '>=1.130.2'], ['wasm-coreutils', '>=1.44.0'], ['slicc-kernel', undefined]]) {
    mkdirSync(join(nm, '@ai-ecoverse', d), { recursive: true });
    writeFileSync(join(nm, '@ai-ecoverse', d, 'package.json'), JSON.stringify({ name: `@ai-ecoverse/${d}`, version: '1.0.0', ...(engines ? { engines: { 'slicc-kernel': engines } } : {}) }));
  }
  assert.deepEqual(enginesFloor([join(dir, 'p.tgz')], nm), { version: '1.130.2', who: '@ai-ecoverse/wasm-bash@1.0.0', range: '>=1.130.2' });
  assert.deepEqual(enginesFloor([join(dir, 'p.tgz')], join(dir, 'none')), { version: '1.110.0', who: '@ai-ecoverse/wasi-pnpm@12.9.1-17', range: '>=1.110.0' });
});
