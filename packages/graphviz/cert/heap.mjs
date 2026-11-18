/**
 * graphviz heap: the measurement behind recipe.yaml's wasm (initial-memory 32MiB, measured-peak,
 * measured-by), which check-threaded-heap requires of a recipe that records them (homescoop#1287;
 * dot.wasm itself has no shared memory, so it is not a threaded module). Rounds of the layouts its user (helix-opspile's diagrams,
 * at most 400 nodes) asks for, and larger: a layered digraph of 400 nodes with clusters, the same
 * as SVG, neato and fdp on a 400-node graph, and a 1,500-node digraph. Each run's VmSize is
 * polled from /proc/<pid>/status: the right output, no wasm trap, and the memory stays at the
 * initial heap, so dot never calls memory.grow.
 */
const ROUNDS = 3;
const INITIAL_KB = 32 * 1024;

/** A layered digraph: `n` nodes in `clusters` clusters, each node to the next two. */
function layered(n, clusters) {
  const lines = ['digraph g {', '  node [shape=box, fixedsize=true, width=1.2, height=0.5];'];
  for (let c = 0; c < clusters; c++) {
    lines.push(`  subgraph cluster_${c} { label="Cluster ${c}";`);
    for (let i = c; i < n; i += clusters) lines.push(`    n${i} [label="Node ${i}\\nsecond line"];`);
    lines.push('  }');
  }
  for (let i = 0; i < n; i++) {
    if (i + 1 < n) lines.push(`  n${i} -> n${i + 1};`);
    if (i + 7 < n) lines.push(`  n${i} -> n${i + 7};`);
  }
  lines.push('}');
  return lines.join('\n');
}
/** An undirected graph of `n` nodes, a ring with chords. */
function ring(n) {
  const lines = ['graph g {'];
  for (let i = 0; i < n; i++) {
    lines.push(`  n${i} -- n${(i + 1) % n};`);
    if (i % 5 === 0) lines.push(`  n${i} -- n${(i * 7 + 3) % n};`);
  }
  lines.push('}');
  return lines.join('\n');
}

const WORK = {
  layered: [['-Tjson', '/tmp/gvh/layered.dot'], 400],
  svg: [['-Tsvg', '/tmp/gvh/layered.dot'], 400],
  neato: [['-Kneato', '-Tjson', '/tmp/gvh/ring.dot'], 400],
  fdp: [['-Kfdp', '-Tjson', '/tmp/gvh/ring.dot'], 400],
  large: [['-Tjson', '/tmp/gvh/large.dot'], 1500],
};

const quote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const script = (name, argv) => [
  `dot ${argv.map(quote).join(' ')} >/tmp/gvh/${name}.out 2>/tmp/gvh/${name}.err & pid=$!; m=0`,
  'while kill -0 $pid 2>/dev/null; do',
  '  if [ -r /proc/$pid/status ]; then while read -r k v u; do [ "$k" = VmSize: ] && [ "$v" -gt "$m" ] && m=$v; done < /proc/$pid/status 2>/dev/null; fi',
  'done; wait $pid; rc=$?',
  `t=0; while IFS= read -r l; do case $l in *"wasm trap"*|*"out of bounds"*|*"memory access"*) t=$((t+1));; esac; done < /tmp/gvh/${name}.err`,
  'echo "rc=$rc peak_kb=$m traps=$t"',
].join('\n');

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/gvh/layered.dot', layered(400, 8));
  await write('/tmp/gvh/ring.dot', ring(400));
  await write('/tmp/gvh/large.dot', layered(1500, 12));
  let traps = 0;
  const peaks = {};
  for (let round = 1; round <= ROUNDS; round++) {
    for (const [name, [argv, nodes]] of Object.entries(WORK)) {
      // eslint-disable-next-line no-await-in-loop
      const r = await run(['bash', '-c', script(name, argv)], { cwd: '/tmp', env: { SLICC_WASM_BACKTRACE: '1' } });
      const m = /rc=(\d+) peak_kb=(\d+) traps=(\d+)/.exec(r.stdout) ?? [];
      traps += Number(m[3] ?? 1);
      peaks[name] = Math.max(peaks[name] ?? 0, Number(m[2] ?? 0));
      // eslint-disable-next-line no-await-in-loop
      const err = await run(['cat', `/tmp/gvh/${name}.err`]);
      assert.equal(Number(m[1]), 0, `round ${round} ${name}: ${r.stdout} ${r.stderr} ${err.stdout}`);
      // eslint-disable-next-line no-await-in-loop
      const out = await run(['cat', `/tmp/gvh/${name}.out`]);
      const placed = name === 'svg'
        ? (out.stdout.match(/class="node"/g) || []).length
        : JSON.parse(out.stdout).objects.filter((o) => o.pos && !/^cluster/.test(o.name)).length;
      assert.equal(placed, nodes, `round ${round} ${name}: every node placed`);
    }
  }
  console.log(`heap: ${ROUNDS} × (dot 400 nodes with clusters, as svg, neato and fdp on 400, dot on 1,500): ${traps} traps, peak ${JSON.stringify(Object.fromEntries(Object.entries(peaks).map(([k, v]) => [k, Math.round(v / 1024)])))} MiB`);
  assert.equal(traps, 0, `no wasm trap in ${ROUNDS} rounds`);
  for (const [name, kb] of Object.entries(peaks)) {
    assert.equal(kb, INITIAL_KB, `${name}: the wasm memory stays at the ${INITIAL_KB / 1024} MiB initial heap, so dot never calls memory.grow (recipe.yaml wasm; homescoop#1287): VmSize peak ${kb} kB`);
  }
}
