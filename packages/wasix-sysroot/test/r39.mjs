// -39: the allocator refreshes this thread's view of the shared memory
// (homescoop#1287, slicc-kernel#1172). R39_RUNS (default 30) processes, each
// growing the heap from several threads with memset/memcpy into fresh
// blocks; every one must exit 0 with no "memory access out of bounds" trap.
export default async function (ctx) {
  const { run, assert } = ctx;
  const runs = Number(process.env.R39_RUNS || 30);
  const traps = [];
  let grown = 0;
  for (let i = 0; i < runs; i++) {
    const r = await run(['r39'], { cwd: '/tmp' });
    const out = `${r.stdout}${r.stderr}`;
    if (r.status !== 0) traps.push(`run ${i}: rc=${r.status} ${out.trim().split('\n').slice(-2).join(' | ')}`);
    const m = /pages (\d+)->(\d+) bad=0/.exec(r.stdout);
    if (m && Number(m[2]) > Number(m[1])) grown++;
  }
  console.log(`r39 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): ${runs - traps.length}/${runs} runs clean, ${grown} grew the memory; ${traps.length} traps${traps.length ? `: ${traps.slice(0, 3).join('; ')}` : ''}`);
  assert.deepEqual(traps, [], `${traps.length}/${runs} runs trapped`);
  assert.ok(grown >= runs - traps.length, 'every clean run grew the memory');
}
