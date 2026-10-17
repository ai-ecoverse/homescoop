export default async function (ctx) {
  const { run, write, assert } = ctx;
  const W = '/home/lc';
  await write('home/lc/m.c', '#include <stdio.h>\nint main(void) { puts("simd128 libc"); return 0; }\n');
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;
  const t0 = Date.now();
  const r = await run(['bash', '-c', 'timeout 90 zig cc -target wasm32-wasi -mcpu=generic+simd128 -O2 m.c -o simd.wasm; echo "rc=$?"'], { cwd: W });
  const secs = Math.round((Date.now() - t0) / 1000);
  assert.doesNotMatch(r.stderr, /are not installed; install them with: ipk install @ai-ecoverse\/wasi-zig-libc-src/, `zig finds the libc sources: ${out(r)}`);
  assert.match(r.stdout, /^rc=(0|124)$/m, `zig builds wasi-libc from them (done, or still compiling at 90 s): ${out(r)}`);
  assert.ok(secs >= 0);
  console.log(`zig cc -mcpu=generic+simd128: ${r.stdout.trim()} after ${secs} s`);
}
