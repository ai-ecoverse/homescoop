import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const STALE = {
  tree: '#847',
};

export function readmeKernelErrors(name, readme, meta) {
  const errors = [];
  for (const m of readme.matchAll(/Certified on `@ai-ecoverse\/slicc-kernel` (\d+\.\d+\.\d+)/g)) {
    const want = /@(\d+\.\d+\.\d+)$/.exec(meta?.kernel ?? '')?.[1];
    if (m[1] !== want) errors.push(`${name}: README says "Certified on @ai-ecoverse/slicc-kernel ${m[1]}", cert/meta.json's kernel is ${want ?? '(none)'}: update the line or drop it`);
  }
  return errors;
}

test('a README that names its cert kernel names cert/meta.json\'s (#847)', () => {
  const found = new Set();
  const errors = [];
  for (const name of readdirSync(join(root, 'packages')).sort()) {
    const readme = join(root, 'packages', name, 'package', 'README.md');
    const meta = join(root, 'packages', name, 'cert', 'meta.json');
    if (!existsSync(readme)) continue;
    const errs = readmeKernelErrors(name, readFileSync(readme, 'utf8'), existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')) : null);
    if (errs.length && STALE[name]) found.add(name);
    else errors.push(...errs);
  }
  for (const name of Object.keys(STALE)) if (!found.has(name)) errors.push(`${name}: its README line is fixed or gone: delete its STALE entry (${STALE[name]})`);
  assert.deepEqual(errors, []);
});

test('readmeKernelErrors', () => {
  const meta = { kernel: '@ai-ecoverse/slicc-kernel@1.102.6' };
  assert.deepEqual(readmeKernelErrors('t', 'Certified on `@ai-ecoverse/slicc-kernel` 1.102.6.\n', meta), []);
  assert.equal(readmeKernelErrors('t', 'Certified on `@ai-ecoverse/slicc-kernel` 1.23.0.\n', meta).length, 1);
  assert.deepEqual(readmeKernelErrors('t', 'no line\n', meta), []);
});
