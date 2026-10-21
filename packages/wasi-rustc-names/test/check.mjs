import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { tarball: { type: 'string' }, rustc: { type: 'string' } } });
const root = new URL('../../../', import.meta.url).pathname;
const recipe = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), 'wasi-rustc-names', '--json'], { encoding: 'utf8' }));
mkdirSync(join(root, '.homescoop-out'), { recursive: true });
const work = mkdtempSync(join(root, '.homescoop-out', 'rustc-names-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const leb = (b, at) => {
  let v = 0, s = 0, x;
  do { x = b[at++]; v += (x & 127) * 2 ** s; s += 7; } while (x & 128);
  return [v, at];
};
const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};
try {
  let rustcTgz = values.rustc;
  if (!rustcTgz) {
    const { url, sha256 } = recipe.sources.wasi_rustc;
    rustcTgz = join(work, 'wasi-rustc.tgz');
    execFileSync('curl', ['-fsSL', '--retry', '3', url, '-o', rustcTgz]);
    check(sha(readFileSync(rustcTgz)) === sha256, `${url} matches sources.wasi_rustc's sha256`);
  }
  execFileSync('tar', ['-xzf', rustcTgz, '-C', work, 'package/bin/rustc.wasm', 'package/package.json']);
  mkdirSync(join(work, 'n'));
  execFileSync('tar', ['-xzf', values.tarball, '-C', join(work, 'n')]);
  const mine = JSON.parse(readFileSync(join(work, 'n/package/package.json'), 'utf8'));
  const theirs = JSON.parse(readFileSync(join(work, 'package/package.json'), 'utf8'));
  check(mine.name === '@ai-ecoverse/wasi-rustc-names' && mine.version === theirs.version, `wasi-rustc-names ${mine.version} is for wasi-rustc ${theirs.version}`);
  check(!mine.scripts && !mine.slicc, 'no scripts, no commands');
  const wasm = readFileSync(join(work, 'package/bin/rustc.wasm'));
  const names = readFileSync(join(work, 'n/package/bin/rustc.wasm.names'));
  let at = 8, imported = 0, defined = 0, hasName = false;
  while (at < wasm.length) {
    const id = wasm[at];
    const [size, body] = leb(wasm, at + 1);
    if (id === 0) {
      const [n, p] = leb(wasm, body);
      if (wasm.toString('utf8', p, p + n) === 'name') hasName = true;
    }
    if (id === 2) {
      let [count, p] = leb(wasm, body);
      for (let i = 0; i < count; i++) {
        let len; [len, p] = leb(wasm, p); p += len;
        [len, p] = leb(wasm, p); p += len;
        const kind = wasm[p++];
        if (kind === 0) { imported++; [, p] = leb(wasm, p); }
        else if (kind === 1) { p++; const flags = wasm[p++]; [, p] = leb(wasm, p); if (flags & 1) [, p] = leb(wasm, p); }
        else if (kind === 2) { const flags = wasm[p++]; [, p] = leb(wasm, p); if (flags & 1) [, p] = leb(wasm, p); }
        else if (kind === 3) { p += 2; }
        else if (kind === 4) { p++; [, p] = leb(wasm, p); }
      }
    }
    if (id === 3) [defined] = leb(wasm, body);
    at = body + size;
  }
  check(!hasName, 'the published rustc.wasm ships without a name section');
  const total = imported + defined;
  // homescoop#1096: count and highest index alone pass a map that names one
  // index twice and another not at all. Every index 0..total-1 exactly once,
  // in increasing order, as the name section's spec requires. The negative
  // cases run first, so the check itself can't pass vacuously.
  const nameMap = (bytes) => {
    let p = 0;
    const indices = [];
    const sample = [];
    while (p < bytes.length) {
      const sub = bytes[p++];
      let size; [size, p] = leb(bytes, p);
      const end = p + size;
      if (sub === 1) {
        let count, q = p; [count, q] = leb(bytes, q);
        for (let i = 0; i < count; i++) {
          let idx, len; [idx, q] = leb(bytes, q); [len, q] = leb(bytes, q);
          if (sample.length < 50000) sample.push(bytes.toString('utf8', q, q + len));
          q += len; indices.push(idx);
        }
      }
      p = end;
    }
    return { indices, sample };
  };
  const complete = (indices, n) => indices.length === n && indices.every((idx, i) => idx === i);
  const synth = (idxs) => {
    const entries = idxs.map((i) => Buffer.from([i, 1, 0x61]));
    const body = Buffer.concat([Buffer.from([idxs.length]), ...entries]);
    return Buffer.concat([Buffer.from([1, body.length]), body]);
  };
  check(complete(nameMap(synth([0, 1, 2])).indices, 3), 'self-test: a complete name map (0, 1, 2) passes');
  check(!complete(nameMap(synth([0, 1, 1])).indices, 3), 'self-test: a duplicated index (0, 1, 1) with 2 missing fails');
  check(!complete(nameMap(synth([0, 2, 1])).indices, 3), 'self-test: indices out of order (0, 2, 1) fail');
  check(!complete(nameMap(synth([0, 1])).indices, 3), 'self-test: a missing last index fails');
  const { indices, sample } = nameMap(names);
  check(complete(indices, total), `one name per function, indices 0..${total - 1} each once and in order: ${indices.length} names; rustc.wasm has ${total} functions (${imported} imported, ${defined} defined)`);
  check(sample.some((n) => /rustc_driver/.test(n)) && sample.some((n) => /llvm/i.test(n)), 'names include rustc_driver and LLVM symbols');
  const whole = Buffer.concat([wasm, Buffer.from([0]), (() => { const body = Buffer.concat([Buffer.from([4]), Buffer.from('name'), names]); const out = []; let n = body.length; do { let b = n & 127; n = Math.floor(n / 128); out.push(n ? b | 128 : b); } while (n); return Buffer.concat([Buffer.from(out), body]); })()]);
  check(WebAssembly.validate(whole), `rustc.wasm with these names appended as its name section validates (${whole.length} bytes)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`wasi-rustc-names: ${failures.length} failed`);
  process.exit(1);
}
console.log('wasi-rustc-names: all checks pass');
