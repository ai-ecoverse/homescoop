// homescoop#1287 (slicc-kernel#1172): threads that allocate and fill or copy
// big buffers while the heap grows. V8 updates a thread's memory length
// lazily, so a memset/memcpy (inlined memory.fill/memory.copy) into a block
// from pages another thread's sbrk just grew could trap "memory access out of
// bounds". wasix-sysroot -39's malloc refreshes the view first
// (patches/dlmalloc-memory-view.patch). HEAP_RUNS (default 20) python
// processes, each with 16 threads growing the heap to a few hundred MiB:
// every one exits 0, with no trap.
import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import random, sys, threading
def work(seed):
    r = random.Random(seed)
    keep = []
    for i in range(120):
        n = r.randrange(16 << 10, 1 << 20)
        b = bytearray(n)            # calloc: malloc + memset
        b[:] = bytes([i & 255]) * n # malloc + memset, then memcpy into b
        c = bytes(b)                # malloc + memcpy
        assert c[0] == i & 255 and c[-1] == i & 255
        if r.random() < 0.5:
            keep.append(c)
    return len(keep)
ts = [threading.Thread(target=work, args=(s,)) for s in range(16)]
for t in ts: t.start()
for t in ts: t.join()
print("heap-threads ok")
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/heap_threads.py', SCRIPT);
  const runs = Number(process.env.HEAP_RUNS || 20);
  const traps = [];
  for (let i = 0; i < runs; i++) {
    const r = await run(['python3', '/tmp/heap_threads.py'], { cwd: '/tmp' });
    if (r.status !== 0 || !r.stdout.includes('heap-threads ok')) traps.push(`run ${i}: rc=${r.status} ${`${r.stdout}${r.stderr}`.trim().split('\n').slice(-1)[0]}`);
  }
  console.log(`heap-threads on wasix-python ${python}: ${runs - traps.length}/${runs} runs of 16 threads filling and copying 16 KiB..1 MiB buffers across heap growth exit clean${traps.length ? `; ${traps.slice(0, 3).join('; ')}` : ''}`);
  assert.deepEqual(traps, [], `${traps.length}/${runs} runs trapped`);
}
