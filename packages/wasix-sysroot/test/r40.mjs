// -40: the initial heap (homescoop#1287), sigsetjmp(bufs[i++]) (#1120),
// poll(POLLIN) on a reader-less write end and an O_WRONLY file (#1119),
// readdir d_type of a FIFO (#1124).
export const build = { env: { WASIXCC_LINKER_FLAGS: '--initial-memory=67108864' } };

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r40'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  const heap = /^heap: initial (\d+) pages, grew (\d+) pages$/.exec(lines[0]);
  assert.ok(heap, r.stdout);
  // PIE mains (the PIC trees): no __heap_end from the loader, so the heap
  // runs from __heap_base to memory.size at the first malloc.
  const pie = /pic$/.test(ctx.variant);
  assert.ok(Number(heap[1]) >= 1024, `64 MiB initial memory: ${lines[0]}`);
  assert.equal(Number(heap[2]), 0, `40 MiB of mallocs inside the initial memory don't grow it: ${lines[0]}`);
  assert.deepEqual(lines.slice(1), [
    'sigsetjmp: v=5 i=1',
    'poll POLLIN, writer, reader gone: 1 revents=POLLERR',
    'poll POLLIN, O_WRONLY regular file: 1 revents=POLLIN',
    'readdir: d=dir f=fifo l=lnk r=reg (as lstat)',
    'r40 done',
  ], r.stdout);
  console.log(`r40 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): ${lines[0]}${pie ? ' (PIE main: __heap_base..memory.size)' : ''}; sigsetjmp(bufs[i++]) once; poll POLLIN gives POLLERR on a reader-less write end and POLLIN on an O_WRONLY file; readdir says fifo for a FIFO`);
}
