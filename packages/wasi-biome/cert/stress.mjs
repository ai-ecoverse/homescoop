/**
 * homescoop#1287's stress row for biome (2.5.15-5): biome check over a
 * 1500-file TypeScript project, 8 times, with SLICC_WASM_BACKTRACE=1. biome's
 * crawler and module graph run on threads (rayon), allocating while the
 * shared memory grows: V8 could trap a memset into a fresh block (stale
 * per-thread memory length, slicc-kernel#1172). 0002 (the allocator refresh)
 * and the 128 MiB initial heap (recipe.yaml wasm) must give 0 traps. Each
 * round also records the wasm memory size (VmSize from /proc/<pid>/status,
 * polled with bash builtins) against the recipe's measured peak.
 */
export default async function (ctx) {
  const { run, write, assert } = ctx;
  const A = 'home/stress';
  await write(`${A}/package.json`, '{"name":"stress","private":true,"type":"module"}');
  await write(`${A}/biome.json`, '{}');
  const body = (i) => `export function f${i}(a: number, b: number): number {\n  const xs = [${Array.from({ length: 50 }, (_, j) => j).join(', ')}];\n  return xs.reduce((s, x) => s + x * a + b, ${i});\n}\n`.repeat(4);
  for (let i = 0; i < 1500; i++) await write(`${A}/src/d${i % 30}/m${i}.ts`, body(i));
  const script = [
    'biome check . >/tmp/biome-out 2>/tmp/biome-err & pid=$!; m=0',
    'while kill -0 $pid 2>/dev/null; do',
    '  if [ -r /proc/$pid/status ]; then while read -r k v u; do [ "$k" = VmSize: ] && [ "$v" -gt "$m" ] && m=$v; done < /proc/$pid/status 2>/dev/null; fi',
    'done; wait $pid; rc=$?',
    't=0; while IFS= read -r l; do case $l in *"wasm trap"*) t=$((t+1));; esac; done < /tmp/biome-err',
    'echo "rc=$rc peak_kb=$m traps=$t"',
  ].join('\n');
  let traps = 0;
  let peak = 0;
  for (let round = 1; round <= 8; round++) {
    const r = await run(['bash', '-c', script], { cwd: `/${A}`, env: { SLICC_WASM_BACKTRACE: '1' } });
    const m = /rc=(\d+) peak_kb=(\d+) traps=(\d+)/.exec(r.stdout) ?? [];
    traps += Number(m[3] ?? 1);
    peak = Math.max(peak, Number(m[2] ?? 0));
    // biome check exits 1 here: the generated files aren't formatted. A trap
    // exits 134.
    assert.notEqual(Number(m[1]), 134, `round ${round}: biome trapped: ${r.stdout} ${r.stderr}`);
  }
  console.log(`stress: 8 × biome check of 1500 files: ${traps} traps, peak ${Math.round(peak / 1024)} MiB`);
  assert.equal(traps, 0, 'no wasm trap in 8 rounds');
  assert.ok(peak > 0 && peak <= 128 * 1024, `the wasm memory stays within the 128 MiB initial heap (peak ${peak} kB)`);
}
