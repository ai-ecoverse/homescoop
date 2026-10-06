#!/usr/bin/env node
/**
 * Host smoke for wasm-binaryen: actually transform a module (not --version).
 * Invokes the Node glue directly so slicc-node-main.js preloads/exports files
 * (run-wasm-cli's extra callMain fights that post-js).
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'packages/wasm-binaryen/package');
const glue = join(pkg, 'bin/wasm-opt');
chmodSync(glue, 0o755);

const work = mkdtempSync(join(tmpdir(), 'binaryen-smoke-'));
const inHost = join(work, 'in.wasm');
const outHost = join(work, 'out.wasm');

// Minimal wasm: (module (func (export "add") (param i32 i32) (result i32) i32.add))
writeFileSync(
  inHost,
  Buffer.from(
    '0061736d0100000001070160027f7f017f030201000707010361646400000a09010700200020016a0b',
    'hex',
  ),
);

const r = spawnSync(process.execPath, [glue, '-O', '/in.wasm', '-o', '/out.wasm'], {
  env: {
    ...process.env,
    SLICC_PRELOAD: `/in.wasm=${inHost}`,
    SLICC_EXPORT: `/out.wasm=${outHost}`,
  },
  encoding: 'utf8',
});
const text = `${r.stdout || ''}${r.stderr || ''}`;
console.log(text.trimEnd());
console.log(`rc=${r.status} :: wasm-opt -O /in.wasm -o /out.wasm`);
if (
  r.status !== 0 ||
  /registered more than once/i.test(text) ||
  /RuntimeError|Aborted\(/.test(text) ||
  /^Fatal:/m.test(text)
) {
  console.error('binaryen smoke: wasm-opt transform failed');
  process.exit(1);
}
if (!existsSync(outHost)) {
  console.error('binaryen smoke: SLICC_EXPORT did not write out.wasm (shutdown trap?)');
  process.exit(1);
}
const out = readFileSync(outHost);
if (out.length < 8 || out.subarray(0, 4).toString() !== '\0asm') {
  console.error('binaryen smoke: wasm-opt did not emit a wasm module');
  process.exit(1);
}
console.log(`out.wasm ${out.length} bytes`);
process.exit(0);
