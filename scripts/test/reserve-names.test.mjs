import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STUB_VERSION, reservedOnNpm, stubManifest, writeStub } from '../reserve-names.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const real = JSON.parse(readFileSync(join(root, 'packages/wasix-openssl/package/package.json'), 'utf8'));

test('the stub is a 0.0.0 package.json and a README, never the real package (wasm-binutils 2.47.0-8)', () => {
  const parent = mkdtempSync(join(tmpdir(), 'reserve-test-'));
  try {
    const dir = writeStub(real, 'wasix-openssl', parent);
    assert.deepEqual(readdirSync(dir).sort(), ['README.md', 'package.json']);
    const m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    assert.equal(m.name, '@ai-ecoverse/wasix-openssl');
    assert.equal(m.version, STUB_VERSION);
    assert.notEqual(m.version, real.version);
    assert.deepEqual(m.repository, real.repository, 'provenance and trust need the repository');
    assert.equal(m.license, real.license);
    for (const k of ['files', 'bin', 'scripts', 'dependencies', 'peerDependencies', 'slicc', 'engines', 'homescoop']) assert.equal(m[k], undefined, k);
    assert.ok(dir.startsWith(parent), 'written under a fresh temporary directory');
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('NEGATIVE: npm pack of the stub holds only the stub, at 0.0.0', () => {
  const parent = mkdtempSync(join(tmpdir(), 'reserve-test-'));
  try {
    const dir = writeStub(real, 'wasix-openssl', parent);
    const r = spawnSync('npm', ['pack', '--dry-run', '--json', dir], { encoding: 'utf8', cwd: parent });
    assert.equal(r.status, 0, r.stderr);
    const [info] = JSON.parse(r.stdout);
    assert.equal(info.version, '0.0.0');
    assert.deepEqual(info.files.map((f) => f.path).sort(), ['README.md', 'package.json']);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('a name is reserved when npm has any version: the packument, 0.0.0 or 0.0.0-stage', async () => {
  const fake = (ok) => async (url) => ({ status: ok.some((s) => url.endsWith(s)) ? 200 : 404 });
  const n = '@ai-ecoverse/x';
  assert.equal(await reservedOnNpm(n, { fetch: fake(['%2Fx']) }), true, 'real versions only (wasm-binutils has no 0.0.0)');
  assert.equal(await reservedOnNpm(n, { fetch: fake(['/0.0.0']) }), true);
  assert.equal(await reservedOnNpm(n, { fetch: fake(['/0.0.0-stage']) }), true, 'a hand-made stage stub');
  assert.equal(await reservedOnNpm(n, { fetch: fake([]) }), false);
  await assert.rejects(reservedOnNpm(n, { fetch: async () => ({ status: 503 }) }), /503/);
});

test('stubManifest refuses a package.json without a name', () => {
  assert.throws(() => stubManifest({}, 'x'), /no name/);
});
