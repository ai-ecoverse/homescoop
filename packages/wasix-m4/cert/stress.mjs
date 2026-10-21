/**
 * homescoop#1287's stress row for m4 (1.4.20-7): three m4 workloads, 8 rounds
 * each, with SLICC_WASM_BACKTRACE=1: a table of 20000 macros, a 1 MiB string
 * doubled and patsubst'ed to 2 MiB, and 6 MiB through a diversion. m4.wasm is
 * a threaded bulk-memory module (shared memory, memory.fill/copy), so a grow
 * could trap (slicc-kernel#1172). With the 32 MiB initial heap and -40's
 * dlmalloc, which allocates from the initial pages, the memory never grows:
 * VmSize stays at 32 MiB and there are 0 traps.
 */
const LOOP = "define(`forloop', `pushdef(`$1', `$2')_forloop($@)popdef(`$1')')define(`_forloop', `$4`'ifelse($1, `$3', `', `define(`$1', incr($1))$0($@)')')dnl\n";
const WORK = {
  table: LOOP + "forloop(`i', `1', `20000', `define(`m'i, `value number 'i` of the table')')forloop(`i', `1', `20000', `ifelse(len(m'i`), 0, `x')')dnl\nlen(m20000)\n",
  grow: LOOP + "define(`s', `xxxxxxxx')forloop(`i', `1', `17', `define(`s', defn(`s')defn(`s'))')len(patsubst(defn(`s'), `x', `yy'))\n",
  divert: LOOP + "define(`s', `0123456789abcdef')forloop(`i', `1', `14', `define(`s', defn(`s')defn(`s'))')divert(`1')forloop(`i', `1', `24', `s')divert(`0')undivert(`1')dnl\n",
};

export default async function (ctx) {
  const { run, write, assert } = ctx;
  for (const [name, text] of Object.entries(WORK)) await write(`/tmp/m4s/${name}.m4`, text);
  const script = (name) =>
    [
      `m4 /tmp/m4s/${name}.m4 >/tmp/m4s/${name}.out 2>/tmp/m4s/${name}.err & pid=$!; m=0`,
      'while kill -0 $pid 2>/dev/null; do',
      '  if [ -r /proc/$pid/status ]; then while read -r k v u; do [ "$k" = VmSize: ] && [ "$v" -gt "$m" ] && m=$v; done < /proc/$pid/status 2>/dev/null; fi',
      'done; wait $pid; rc=$?',
      `t=0; while IFS= read -r l; do case $l in *"wasm trap"*|*"out of bounds"*) t=$((t+1));; esac; done < /tmp/m4s/${name}.err`,
      `c=$(wc -c < /tmp/m4s/${name}.out)`,
      'echo "rc=$rc peak_kb=$m traps=$t chars=$c"',
    ].join('\n');
  const want = { table: '31', grow: '2097152', divert: 6291456 };
  const INITIAL_KB = 32 * 1024;
  let traps = 0;
  const peaks = {};
  for (let round = 1; round <= 8; round++) {
    for (const name of Object.keys(WORK)) {
      const r = await run(['bash', '-c', script(name)], { cwd: '/tmp', env: { SLICC_WASM_BACKTRACE: '1' } });
      const m = /rc=(\d+) peak_kb=(\d+) traps=(\d+) chars=(\d+)/.exec(r.stdout) ?? [];
      traps += Number(m[3] ?? 1);
      peaks[name] = Math.max(peaks[name] ?? 0, Number(m[2] ?? 0));
      assert.equal(Number(m[1]), 0, `round ${round} ${name}: ${r.stdout} ${r.stderr}`);
      if (name !== 'divert') {
        const out = await run(['cat', `/tmp/m4s/${name}.out`]);
        assert.equal(out.stdout.trim(), want[name], `round ${round} ${name}`);
      } else assert.equal(Number(m[4]), want.divert, `round ${round} divert: ${r.stdout}`);
    }
  }
  const peak = Math.max(...Object.values(peaks));
  console.log(`stress: 8 × (a 20000-macro table, a 1 MiB string doubled and patsubst'ed to 2 MiB, 6 MiB through a diversion): ${traps} traps, peak ${JSON.stringify(Object.fromEntries(Object.entries(peaks).map(([k, v]) => [k, Math.round(v / 1024)])))} MiB`);
  assert.equal(traps, 0, 'no wasm trap in 8 rounds');
  for (const [name, kb] of Object.entries(peaks)) assert.equal(kb, INITIAL_KB, `${name}: the wasm memory stays at the 32 MiB initial heap, so m4 never calls memory.grow (recipe.yaml wasm, wasix-sysroot -40's dlmalloc uses the initial pages; homescoop#1287): VmSize peak ${kb} kB`);
}
