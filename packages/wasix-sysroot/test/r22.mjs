/**
 * wasix-sysroot 2025.9.30-22: test/r22.c.
 * - The linked program carries the libc generation marker: a wasm custom
 *   section `slicc.libc` = "wasix-sysroot <version>" (from crt1*.o).
 * - __homescoop_itimer_real_left is gone (static in setitimer.c), so a
 *   dynamic-main (--variant ehpic) no longer exports it; getitimer() still
 *   reports what setitimer() armed.
 */
import { readFileSync } from 'node:fs';

function sections(buf) {
  let p = 8;
  const leb = () => {
    let r = 0, s = 0, b;
    do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80);
    return r >>> 0;
  };
  const str = () => { const n = leb(); const v = buf.subarray(p, p + n).toString('utf8'); p += n; return v; };
  const custom = {};
  const exports = [];
  while (p < buf.length) {
    const id = buf[p++];
    const size = leb();
    const end = p + size;
    if (id === 0) {
      const name = str();
      custom[name] = (custom[name] ?? '') + buf.subarray(p, end).toString('utf8');
    } else if (id === 7) {
      for (let n = leb(); n > 0; n--) { exports.push(str()); p++; leb(); }
    }
    p = end;
  }
  return { custom, exports };
}

export default async function (ctx) {
  const { run, assert, wasm } = ctx;
  const { custom, exports } = sections(readFileSync(wasm));
  const marker = custom['slicc.libc'];
  assert.match(marker ?? '', /^wasix-sysroot 2025\.9\.30-(\d+)$/, `slicc.libc custom section: ${JSON.stringify(marker)}`);
  assert.ok(Number(marker.split('-').pop()) >= 22, marker);
  assert.ok(!exports.includes('__homescoop_itimer_real_left'), 'the itimer helper is exported');
  console.log(`r22: slicc.libc "${marker}", ${exports.length} exports, no itimer helper`);

  const r = await run(['r22'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  assert.match(lines[0], /^armed: set=0 get=0 left=[45]s interval=0s$/, r.stdout);
  assert.equal(lines[1], 'virtual: -1 EINVAL', r.stdout);
  assert.match(lines[2], /^disarmed: left=0 old=[45]s$/, r.stdout);
}
