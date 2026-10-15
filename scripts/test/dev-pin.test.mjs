import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { certKernel } from '../browser-cert/cert-kernel.mjs';
import { devPin } from '../dev-pin.mjs';

function withRepo({ devDependencies, meta }, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'homescoop-pins-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'homescoop', private: true, devDependencies }));
    mkdirSync(join(dir, 'packages', 'p', 'cert'), { recursive: true });
    if (meta !== undefined) writeFileSync(join(dir, 'packages', 'p', 'cert', 'meta.json'), meta);
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pins = {
  '@ai-ecoverse/slicc-kernel': '1.94.0',
  'playwright-core': '1.63.0',
  'slicc-kernel-negative': 'npm:@ai-ecoverse/slicc-kernel@1.78.0',
};

test('devPin: an exact devDependency, or the target of an npm alias', () => {
  withRepo({ devDependencies: pins }, (dir) => {
    assert.equal(devPin('@ai-ecoverse/slicc-kernel', { dir }), '@ai-ecoverse/slicc-kernel@1.94.0');
    assert.equal(devPin('playwright-core', { dir }), 'playwright-core@1.63.0');
    assert.equal(devPin('slicc-kernel-negative', { dir }), '@ai-ecoverse/slicc-kernel@1.78.0');
  });
});

test('devPin: a missing entry or a range fails', () => {
  withRepo({ devDependencies: { a: '^1.0.0', b: 'latest', c: 'npm:@x/y@~2.0.0', d: '1.2.3-4' } }, (dir) => {
    assert.throws(() => devPin('nope', { dir }), /no devDependencies entry nope/);
    for (const n of ['a', 'b', 'c']) assert.throws(() => devPin(n, { dir }), /not an exact version/, n);
    assert.equal(devPin('d', { dir }), 'd@1.2.3-4');
  });
});

test('certKernel: cert/meta.json kernel wins', () => {
  withRepo({ devDependencies: pins, meta: JSON.stringify({ kernel: '@ai-ecoverse/slicc-kernel@1.71.0' }) }, (dir) => {
    const lines = [];
    assert.equal(certKernel('p', { dir, log: (l) => lines.push(l) }), '@ai-ecoverse/slicc-kernel@1.71.0');
    assert.match(lines[0], /from packages\/p\/cert\/meta\.json/);
  });
});

test('certKernel: no kernel in cert/meta.json takes the package.json pin', () => {
  for (const meta of [undefined, '{}', '{"kernel":""}', 'not json']) {
    withRepo({ devDependencies: pins, meta }, (dir) => {
      const lines = [];
      assert.equal(certKernel('p', { dir, log: (l) => lines.push(l) }), '@ai-ecoverse/slicc-kernel@1.94.0');
      assert.match(lines[0], /kernel @ai-ecoverse\/slicc-kernel@1\.94\.0 from package\.json devDependencies/);
    });
  }
});

test('certKernel: no pin fails closed', () => {
  withRepo({ devDependencies: {} }, (dir) => {
    assert.throws(() => certKernel('p', { dir, log: () => {} }), /no devDependencies entry @ai-ecoverse\/slicc-kernel/);
  });
});
