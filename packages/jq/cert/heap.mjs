const N = 25000;
const GEN = `[range(${N}) | {id: ., name: "user\\(.)", tags: ["a", "b", (. % 7)], nested: {x: (. * 1.5), s: ("x" * 20)}}]`;
const WORK = {
  generate: ['-c', '-n', GEN],
  select: ['-c', 'map(select(.id % 3 == 0)) | length', '/tmp/jqh/big.json'],
  group: ['-c', 'group_by(.tags[2]) | map(length)', '/tmp/jqh/big.json'],
  sort: ['-c', 'sort_by(-.nested.x) | .[0].id', '/tmp/jqh/big.json'],
  stream: ['-c', '--stream', 'select(length == 2) | .[1]', '/tmp/jqh/big.json'],
};
const WANT = {
  select: String(Math.ceil(N / 3)),
  group: JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((r) => Math.floor((N - 1 - r) / 7) + 1)),
  sort: String(N - 1),
};
const ROUNDS = 4;
const INITIAL_KB = 64 * 1024;

const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const script = (name, argv) =>
  [
    `jq ${argv.map(quote).join(' ')} >/tmp/jqh/${name}.out 2>/tmp/jqh/${name}.err & pid=$!; m=0`,
    'while kill -0 $pid 2>/dev/null; do',
    '  if [ -r /proc/$pid/status ]; then while read -r k v u; do [ "$k" = VmSize: ] && [ "$v" -gt "$m" ] && m=$v; done < /proc/$pid/status 2>/dev/null; fi',
    'done; wait $pid; rc=$?',
    `t=0; while IFS= read -r l; do case $l in *"wasm trap"*|*"out of bounds"*|*"memory access"*) t=$((t+1));; esac; done < /tmp/jqh/${name}.err`,
    `c=$(wc -c < /tmp/jqh/${name}.out)`,
    'echo "rc=$rc peak_kb=$m traps=$t chars=$c"',
  ].join('\n');

export default async function (ctx) {
  const { run, assert } = ctx;
  await run(['mkdir', '-p', '/tmp/jqh']);
  let traps = 0;
  const peaks = {};
  for (let round = 1; round <= ROUNDS; round++) {
    for (const [name, argv] of Object.entries(WORK)) {
      const r = await run(['bash', '-c', script(name, argv)], { cwd: '/tmp', env: { SLICC_WASM_BACKTRACE: '1' } });
      const m = /rc=(\d+) peak_kb=(\d+) traps=(\d+) chars=(\d+)/.exec(r.stdout) ?? [];
      traps += Number(m[3] ?? 1);
      peaks[name] = Math.max(peaks[name] ?? 0, Number(m[2] ?? 0));
      if (name === 'generate') {
        await run(['bash', '-c', 'cp /tmp/jqh/generate.out /tmp/jqh/big.json']);
      }
      const err = await run(['cat', `/tmp/jqh/${name}.err`]);
      assert.equal(Number(m[1]), 0, `round ${round} ${name}: ${r.stdout} ${r.stderr} ${err.stdout}`);
      if (WANT[name]) {
        const out = await run(['cat', `/tmp/jqh/${name}.out`]);
        assert.equal(out.stdout.trim(), WANT[name], `round ${round} ${name}`);
      } else assert.ok(Number(m[4]) > N * 50, `round ${round} ${name}: ${r.stdout}`);
    }
  }
  console.log(`heap: ${ROUNDS} × (generate ${N} objects, select, group_by, sort_by, --stream): ${traps} traps, peak ${JSON.stringify(Object.fromEntries(Object.entries(peaks).map(([k, v]) => [k, Math.round(v / 1024)])))} MiB`);
  assert.equal(traps, 0, `no wasm trap in ${ROUNDS} rounds`);
  for (const [name, kb] of Object.entries(peaks)) assert.equal(kb, INITIAL_KB, `${name}: the wasm memory stays at the ${INITIAL_KB / 1024} MiB initial heap, so jq never calls memory.grow (recipe.yaml wasm; homescoop#1287): VmSize peak ${kb} kB`);
}
