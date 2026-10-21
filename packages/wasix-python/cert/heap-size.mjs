import { repin } from './fixtures/repin.mjs';

const MIB = 1 << 20;
const INITIAL = 160 * MIB;

const SCRIPT = String.raw`
import ctypes, json, os, struct, sys
libc = ctypes.CDLL(None)
libc.sbrk.restype = ctypes.c_size_t
libc.sbrk.argtypes = [ctypes.c_ssize_t]
def leb(b, p):
    r = s = 0
    while True:
        x = b[p]; p += 1
        r |= (x & 0x7f) << s; s += 7
        if not x & 0x80:
            return r, p
def linked(path):
    b = open(path, "rb").read()
    p = 8
    while p < len(b):
        sid = b[p]; p += 1
        size, p = leb(b, p)
        end = p + size
        if sid == 2:
            n, p = leb(b, p)
            for _ in range(n):
                for _ in range(2):
                    l, p = leb(b, p); p += l
                kind = b[p]; p += 1
                if kind == 2:
                    flags = b[p]; p += 1
                    initial, p = leb(b, p)
                    return initial * 65536
                if kind == 0:
                    _, p = leb(b, p)
                elif kind == 1:
                    p += 1; flags = b[p]; p += 1; _, p = leb(b, p)
                    if flags & 1: _, p = leb(b, p)
                elif kind == 3:
                    p += 2
                elif kind == 4:
                    p += 1; _, p = leb(b, p)
        p = end
    return None
out = {"linked": linked(os.path.join(sys.base_prefix, "bin", "python.wasm")), "start": libc.sbrk(0)}
keep = [bytearray(256 << 10) for _ in range(192)]
out["malloc48"] = libc.sbrk(0)
del keep
import numpy, pandas, scipy.optimize, scipy.integrate, scipy.linalg, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot
out["imports"] = libc.sbrk(0)
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/home/heap_size.py', SCRIPT);
  const pins = await repin(ctx);
  let r;
  try {
    r = await run(['python3', '/home/heap_size.py'], { cwd: '/home', env: { MPLBACKEND: 'Agg' } });
  } finally {
    await pins.restore();
  }
  assert.equal(r.status, 0, `heap_size.py: rc=${r.status}\n${r.stdout}\n${r.stderr}`);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  const mib = (n) => `${(n / MIB).toFixed(1)} MiB`;
  const problems = [];
  if (o.linked !== INITIAL) problems.push(`bin/python.wasm links an initial memory of ${mib(o.linked)}, want recipe.yaml wasm.initial-memory ${mib(INITIAL)}`);
  if (o.start !== INITIAL) problems.push(`memory at start ${mib(o.start)}, want ${mib(INITIAL)}`);
  if (o.malloc48 !== o.start) problems.push(`48 MiB of 256 KiB buffers grew the memory from ${mib(o.start)} to ${mib(o.malloc48)}: malloc does not use the initial memory`);
  assert.deepEqual(problems, [], `heap-size: ${problems.join('; ')} (after the imports: ${mib(o.imports)})`);
  assert.ok(o.imports >= INITIAL, `memory after the imports ${mib(o.imports)}`);
  console.log(`heap-size: python.wasm links ${mib(o.linked)}; memory ${mib(o.start)} at start, ${mib(o.malloc48)} after 48 MiB of mallocs (no memory.grow), ${mib(o.imports)} after importing numpy, pandas, scipy and matplotlib (heap plus the side modules the loader places above it)`);
}
