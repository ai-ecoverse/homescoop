/**
 * wasix-openssh 10.6.0-6: built on wasix-sysroot >= 2025.9.30-22, every
 * binary carries the libc generation marker, a wasm custom section
 * slicc.libc = "wasix-sysroot <version>" (from crt1.o), so slicc-kernel
 * gives it -19+ semantics (EINTR from clock_nanosleep/poll).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function custom(buf, want) {
  let p = 8;
  const leb = () => {
    let r = 0, s = 0, b;
    do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80);
    return r >>> 0;
  };
  while (p < buf.length) {
    const id = buf[p++];
    const end = leb() + p;
    if (id === 0) {
      const n = leb();
      const name = buf.subarray(p, p + n).toString('utf8');
      if (name === want) return buf.subarray(p + n, end).toString('utf8');
    }
    p = end;
  }
  return undefined;
}

export default async function marker(ctx) {
  const { assert, pkgDir } = ctx;
  const bins = readdirSync(join(pkgDir, 'bin')).filter((f) => f.endsWith('.wasm'));
  assert.ok(bins.length >= 2, `bin: ${bins}`);
  for (const b of bins) {
    const m = custom(readFileSync(join(pkgDir, 'bin', b)), 'slicc.libc');
    assert.match(m ?? '', /^wasix-sysroot 2025\.9\.30-(\d+)$/, `${b}: slicc.libc ${JSON.stringify(m)}`);
    assert.ok(Number(m.split('-').pop()) >= 22, `${b}: ${m}`);
  }
  console.log(`marker: ${bins.join(', ')} carry slicc.libc`);
}
