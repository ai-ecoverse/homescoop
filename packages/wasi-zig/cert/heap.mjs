/**
 * homescoop#1287's stress row for zig (0.16.0-19): LLVM's threads allocate
 * through wasi-libc's malloc, wrapped at the link by
 * scripts/wasm-refresh-malloc.c so a block above a thread's view of the
 * shared memory refreshes the view first (V8's stale per-thread memory
 * length, slicc-kernel#1172). 3 rounds of 4 concurrent `zig cc -O2` of a
 * generated C file plus a `zig build-exe -OReleaseFast` of a Zig file, under
 * SLICC_WASM_BACKTRACE=1 (new sources each round), and a cold @cImport
 * (which builds translate-c first), detached and polled: 0 wasm traps, every build
 * exits 0, and malloc's highest block end (HOMESCOOP_WASM_PEAK, measured in
 * the allocating thread; a thread's VmSize can be its stale view) stays
 * within recipe.yaml's wasm.initial-memory.
 */
const C = (k) => `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n` +
  Array.from({ length: 120 }, (_, i) => `static int f${i}(int x) { char b[64]; snprintf(b, sizeof b, "%d-${k}-${i}", x); return (int)strlen(b) * ${i + 1} + x; }`).join('\n') +
  `\nint main(void) { long t = 0; ${Array.from({ length: 120 }, (_, i) => `t += f${i}(${i});`).join(' ')} printf("%ld\\n", t); return 0; }\n`;
const ZIG = (k) => 'const std = @import("std");\n' +
  Array.from({ length: 80 }, (_, i) => `fn g${i}(x: u64) u64 { var s: u64 = x; var i: u64 = 0; while (i < ${i + 10}) : (i += 1) s = s *% ${31 + k} +% i; return s; }`).join('\n') +
  `\npub fn main() void { var t: u64 = 0; ${Array.from({ length: 80 }, (_, i) => `t +%= g${i}(${i});`).join(' ')} std.debug.print("{d}\\n", .{t}); }\n`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const R = '/home/zh';
  const sh = (s) => run(['bash', '-c', s], { cwd: R });
  const initialMiB = Number(process.env.ZIG_INITIAL_MIB || 96);
  let traps = 0;
  let heap = 0;
  let mem = 0;
  for (let round = 1; round <= 3; round++) {
    // New sources each round, so no build is a cache hit.
    for (let k = 0; k < 4; k++) await write(`home/zh/c${k}.c`, C(round * 10 + k));
    await write('home/zh/z.zig', ZIG(round));
    const jobs = [...[0, 1, 2, 3].map((k) => [`c${k}`, `zig cc -target wasm32-wasi -O2 c${k}.c -o c${k}.wasm`]), ['z', 'zig build-exe z.zig -target wasm32-wasi -OReleaseFast']];
    const start = await sh(`rm -f *.rc *.peak; ${jobs.map(([t, cmd]) => `bash -c 'SLICC_WASM_BACKTRACE=1 HOMESCOOP_WASM_PEAK=${R}/${t}.peak ${cmd} >${t}.out 2>${t}.err; echo $? > ${t}.rc' </dev/null >/dev/null 2>&1 &`).join(' ')}`);
    assert.equal(start.status, 0, start.stderr);
    const t0 = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const p = await sh('n=0; for f in c0 c1 c2 c3 z; do [ -s $f.rc ] && n=$((n+1)); done; echo $n');
      if (p.stdout.trim() === '5') break;
      assert.ok(Date.now() - t0 < 1500000, `round ${round}: the builds finish within 25 min`);
    }
    for (const [t] of jobs) {
      const r = await sh(`read -r rc < ${t}.rc; tr=0; while IFS= read -r l; do case $l in *"wasm trap"*) tr=$((tr+1));; esac; done < ${t}.err; pk=; [ -s ${t}.peak ] && read -r pk < ${t}.peak; echo "rc=$rc traps=$tr peak=$pk"; [ $rc = 0 ] || tail -5 ${t}.err`);
      const m = /rc=(\d+) traps=(\d+) peak=(\d*) ?(\d*)/.exec(r.stdout) ?? [];
      traps += Number(m[2] ?? 1);
      heap = Math.max(heap, Number(m[3] || 0));
      mem = Math.max(mem, Number(m[4] || 0));
      assert.equal(Number(m[1]), 0, `round ${round}: ${t}: ${r.stdout}`);
    }
    console.log(`heap: round ${round} in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  // A cold @cImport: zig builds its translate-c tool (the heaviest use here).
  await write('home/zh/ci.zig', 'const c = @cImport(@cInclude("stdio.h"));\npub fn main() void { _ = c.printf("ci\\n"); }\n');
  await sh(`rm -f ci.rc; bash -c 'SLICC_WASM_BACKTRACE=1 HOMESCOOP_WASM_PEAK=${R}/ci.peak zig build-exe ci.zig -lc -target wasm32-wasi >ci.out 2>ci.err; echo $? > ci.rc' </dev/null >/dev/null 2>&1 &`);
  const t1 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    if ((await sh('[ -s ci.rc ] && echo y')).stdout.trim() === 'y') break;
    assert.ok(Date.now() - t1 < 1500000, 'the @cImport build finishes within 25 min');
  }
  {
    const r = await sh('read -r rc < ci.rc; tr=0; while IFS= read -r l; do case $l in *"wasm trap"*) tr=$((tr+1));; esac; done < ci.err; pk=; [ -s ci.peak ] && read -r pk < ci.peak; echo "rc=$rc traps=$tr peak=$pk"; [ $rc = 0 ] || tail -5 ci.err');
    const m = /rc=(\d+) traps=(\d+) peak=(\d*) ?(\d*)/.exec(r.stdout) ?? [];
    traps += Number(m[2] ?? 1);
    heap = Math.max(heap, Number(m[3] || 0));
    mem = Math.max(mem, Number(m[4] || 0));
    assert.equal(Number(m[1]), 0, `@cImport build: ${r.stdout}`);
    console.log(`heap: cold @cImport in ${Math.round((Date.now() - t1) / 1000)} s, malloc peak ${Math.round(Number(m[3] || 0) / 1048576)} MiB`);
  }
  const run1 = await sh('./c0.wasm && ./z.wasm && ./ci.wasm');
  assert.equal(run1.status, 0, run1.stderr);
  console.log(`heap: 3 × (4 zig cc -O2 + zig build-exe -OReleaseFast) and a cold @cImport: ${traps} traps, malloc peak ${Math.round(heap / 1048576)} MiB, memory at exit ${Math.round(mem / 1048576)} MiB`);
  assert.equal(traps, 0, 'no wasm trap in 16 zig runs');
  // malloc's heap is what the initial memory is for: wasi-libc's dlmalloc
  // uses the pages up to the initial size first. Zig's own allocator grows
  // the memory itself, so the memory size is logged, not checked.
  assert.ok(heap > 0 && heap <= initialMiB * 1048576, `malloc's highest block stays within the ${initialMiB} MiB initial heap (${heap} bytes)`);
}
