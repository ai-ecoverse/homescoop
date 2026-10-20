/**
 * homescoop#1287's stress row for impeccable (0.1.15-5): `impeccable detect`
 * over a 600-file site, 6 times, with SLICC_WASM_BACKTRACE=1. Since 0.1.15-6
 * (homescoop#1363) each detect runs detached, and the spec polls it with
 * short `run`s (one a second, each reading VmSize once), so no harness call
 * comes near its 120 s limit on a slow runner and no busy loop competes with
 * detect's threads. Its scanners
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
  const sh = (s) => run(['bash', '-c', s], { cwd: '/home/stress', env: { SLICC_WASM_BACKTRACE: '1' } });
  let traps = 0;
  let peak = 0;
  const times = [];
  for (let round = 1; round <= 6; round++) {
    const t0 = Date.now();
    const start = await sh(`rm -f /tmp/imp-done /tmp/imp-pid; bash -c 'impeccable detect --json /home/stress/site >/tmp/imp-out 2>/tmp/imp-err & echo $! > /tmp/imp-pid; wait $!; echo $? > /tmp/imp-done' </dev/null >/dev/null 2>&1 &`);
    assert.equal(start.status, 0, `round ${round}: start: ${start.stderr}`);
    let rc;
    for (let i = 0; i < 900 && rc === undefined; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const p = await sh('[ -s /tmp/imp-done ] && { read -r rc < /tmp/imp-done; echo "done $rc"; exit 0; }; [ -s /tmp/imp-pid ] || exit 0; read -r pid < /tmp/imp-pid; while read -r k v u; do [ "$k" = VmSize: ] && echo "vm $v"; done < /proc/$pid/status 2>/dev/null; exit 0');
      const d = /done (\d+)/.exec(p.stdout);
      if (d) rc = Number(d[1]);
      const v = /vm (\d+)/.exec(p.stdout);
      if (v) peak = Math.max(peak, Number(v[1]));
    }
    times.push(Math.round((Date.now() - t0) / 1000));
    const e = await sh('t=0; while IFS= read -r l; do case $l in *"wasm trap"*) t=$((t+1));; esac; done < /tmp/imp-err; echo "traps=$t"');
    traps += Number(/traps=(\d+)/.exec(e.stdout)?.[1] ?? 1);
    // detect exits 2 with findings; a trap exits 134.
    assert.equal(rc, 2, `round ${round}: impeccable detect exit (2: findings): ${rc} ${e.stdout}`);
  }
  console.log(`stress: 6 × impeccable detect of 600 pages: ${traps} traps, peak ${Math.round(peak / 1024)} MiB, ${times.join('/')} s`);
  assert.equal(traps, 0, 'no wasm trap in 6 rounds');
  const limit = Number(process.env.IMPECCABLE_INITIAL_MIB || 64) * 1024;
  assert.ok(peak > 0 && peak <= limit, `the wasm memory stays within the initial heap (peak ${peak} kB, limit ${limit} kB)`);
}
