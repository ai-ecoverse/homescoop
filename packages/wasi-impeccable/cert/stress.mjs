/**
 * homescoop#1287's stress row for impeccable (0.1.15-5): `impeccable detect`
 * over a 600-file site, 6 times, with SLICC_WASM_BACKTRACE=1. Its scanners
 * run on threads, allocating while the shared memory grows: V8 could trap a
 * memset into a fresh block (stale per-thread memory length,
 * slicc-kernel#1172). 0002 (the allocator refresh) and the initial heap
 * (recipe.yaml wasm) must give 0 traps. Each round also records the wasm
 * memory size (VmSize from /proc/<pid>/status, polled with bash builtins).
 */
const PAGE = (i) => `<!doctype html>
<html><head><style>
body { font-family: Inter, Arial, sans-serif; color: #000; background: #fff; }
.hero${i} { background: linear-gradient(135deg, #667eea, #764ba2); }
${Array.from({ length: 40 }, (_, j) => `.c${i}-${j} { color: #${(i * 7919 + j * 104729).toString(16).padStart(6, '0').slice(-6)}; margin: ${j}px; }`).join('\n')}
</style></head><body>
<div class="hero${i}"><h1>Page ${i}</h1><p style="color:#999">gray on purple</p></div>
${Array.from({ length: 40 }, (_, j) => `<p class="c${i}-${j}">paragraph ${j} of page ${i}</p>`).join('\n')}
</body></html>
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  for (let i = 0; i < 600; i++) await write(`home/stress/site/d${i % 20}/p${i}.html`, PAGE(i));
  const script = [
    'impeccable detect --json /home/stress/site >/tmp/imp-out 2>/tmp/imp-err & pid=$!; m=0',
    'while kill -0 $pid 2>/dev/null; do',
    '  if [ -r /proc/$pid/status ]; then while read -r k v u; do [ "$k" = VmSize: ] && [ "$v" -gt "$m" ] && m=$v; done < /proc/$pid/status 2>/dev/null; fi',
    'done; wait $pid; rc=$?',
    't=0; while IFS= read -r l; do case $l in *"wasm trap"*) t=$((t+1));; esac; done < /tmp/imp-err',
    'echo "rc=$rc peak_kb=$m traps=$t"',
  ].join('\n');
  let traps = 0;
  let peak = 0;
  for (let round = 1; round <= 6; round++) {
    const r = await run(['bash', '-c', script], { cwd: '/home/stress', env: { SLICC_WASM_BACKTRACE: '1' } });
    const m = /rc=(\d+) peak_kb=(\d+) traps=(\d+)/.exec(r.stdout) ?? [];
    traps += Number(m[3] ?? 1);
    peak = Math.max(peak, Number(m[2] ?? 0));
    // detect exits 2 with findings; a trap exits 134.
    assert.equal(Number(m[1]), 2, `round ${round}: impeccable detect: ${r.stdout} ${r.stderr}`);
  }
  console.log(`stress: 6 × impeccable detect of 600 pages: ${traps} traps, peak ${Math.round(peak / 1024)} MiB`);
  assert.equal(traps, 0, 'no wasm trap in 6 rounds');
  const limit = Number(process.env.IMPECCABLE_INITIAL_MIB || 64) * 1024;
  assert.ok(peak > 0 && peak <= limit, `the wasm memory stays within the initial heap (peak ${peak} kB, limit ${limit} kB)`);
}
