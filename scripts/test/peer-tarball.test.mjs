import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { peerTarball } from '../peer-tarball.mjs';

function fixture(fn) {
  const base = mkdtempSync(join(tmpdir(), 'peer-tarball-'));
  try {
    mkdirSync(join(base, 'packages/wasm-go-std-wasip1/package'), { recursive: true });
    writeFileSync(join(base, 'packages/wasm-go-std-wasip1/package/package.json'), JSON.stringify({ name: '@ai-ecoverse/wasm-go-std-wasip1', version: '1.27.2-1' }));
    const art = (dir, name, manifest, sum = true) => {
      const d = join(dir, name);
      mkdirSync(join(d, 'src/package'), { recursive: true });
      writeFileSync(join(d, 'src/package/package.json'), JSON.stringify(manifest));
      execFileSync('tar', ['-czf', join(d, 'package.tgz'), '-C', join(d, 'src'), 'package']);
      const hex = createHash('sha256').update(readFileSync(join(d, 'package.tgz'))).digest('hex');
      if (sum) writeFileSync(join(d, 'package.tgz.sha256'), `${sum === true ? hex : sum}  package.tgz\n`);
      return join(d, 'package.tgz');
    };
    return fn(base, art);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

const good = { name: '@ai-ecoverse/wasm-go-std-wasip1', version: '1.27.2-1' };

test('no artifact of this run: the registry spec of the recipe version', () => {
  fixture((base) => {
    assert.equal(peerTarball('wasm-go-std-wasip1', { env: {}, base }), '@ai-ecoverse/wasm-go-std-wasip1@1.27.2-1');
  });
});

test('the cert job\'s peer in .homescoop-out/peers, and the reviewers\' in RUNNER_TEMP/review/artifacts', () => {
  fixture((base, art) => {
    const tgz = art(join(base, '.homescoop-out/peers'), 'host-wasm-go-std-wasip1-pr742', good);
    assert.equal(peerTarball('wasm-go-std-wasip1', { env: {}, base }), tgz);
  });
  fixture((base, art) => {
    const tmp = join(base, 'runner');
    const tgz = art(join(tmp, 'review', 'artifacts'), 'host-wasm-go-std-wasip1-pr742', good);
    art(join(tmp, 'review', 'artifacts'), 'host-wasm-go-pr742', { name: '@ai-ecoverse/wasm-go', version: '1.27.2-1' });
    assert.equal(peerTarball('wasm-go-std-wasip1', { env: { RUNNER_TEMP: tmp }, base }), tgz);
  });
});

test('a peer artifact of another version, other bytes or no sha256 fails closed', () => {
  fixture((base, art) => {
    art(join(base, '.homescoop-out/peers'), 'host-wasm-go-std-wasip1-pr742', { ...good, version: '1.26.5-1' });
    assert.throws(() => peerTarball('wasm-go-std-wasip1', { env: {}, base }), /is @ai-ecoverse\/wasm-go-std-wasip1@1\.26\.5-1, packages\/wasm-go-std-wasip1 wants @ai-ecoverse\/wasm-go-std-wasip1@1\.27\.2-1/);
  });
  fixture((base, art) => {
    art(join(base, '.homescoop-out/peers'), 'host-wasm-go-std-wasip1-pr742', good, '0'.repeat(64));
    assert.throws(() => peerTarball('wasm-go-std-wasip1', { env: {}, base }), /its package\.tgz\.sha256 says 0{64}/);
  });
  fixture((base, art) => {
    art(join(base, '.homescoop-out/peers'), 'host-wasm-go-std-wasip1-pr742', good, false);
    assert.throws(() => peerTarball('wasm-go-std-wasip1', { env: {}, base }), /has no package\.tgz\.sha256/);
  });
});

test('one matching artifact, which download-artifact unpacks straight into .homescoop-out/peers', () => {
  fixture((base, art) => {
    const tgz = art(base, '.homescoop-out/peers', good);
    assert.equal(peerTarball('wasm-go-std-wasip1', { env: {}, base }), tgz);
  });
  fixture((base, art) => {
    art(base, '.homescoop-out/peers', { name: '@ai-ecoverse/wasm-go', version: '1.27.2-1' });
    assert.equal(peerTarball('wasm-go-std-wasip1', { env: {}, base }), '@ai-ecoverse/wasm-go-std-wasip1@1.27.2-1');
  });
  fixture((base, art) => {
    art(base, '.homescoop-out/peers', { ...good, version: '1.26.5-1' });
    assert.throws(() => peerTarball('wasm-go-std-wasip1', { env: {}, base }), /wants @ai-ecoverse\/wasm-go-std-wasip1@1\.27\.2-1/);
  });
});
