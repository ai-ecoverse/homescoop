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
def dylink(path):
    b = open(path, "rb").read()
    p = 8
    while p < len(b):
        sid = b[p]; p += 1
        size, p = leb(b, p)
        end = p + size
        if sid == 0:
            n, q = leb(b, p)
            if b[q:q + n] == b"dylink.0":
                q += n
                info = {"mem": 0, "align": 0, "needed": [], "rpath": []}
                while q < end:
                    kind = b[q]; q += 1
                    l, q = leb(b, q)
                    e = q + l
                    if kind == 1:
                        info["mem"], q = leb(b, q)
                        info["align"], q = leb(b, q)
                    elif kind in (2, 5):
                        c, q = leb(b, q)
                        for _ in range(c):
                            sl, q = leb(b, q)
                            info["needed" if kind == 2 else "rpath"].append(b[q:q + sl].decode())
                            q += sl
                    q = e
                return info
        p = end
    return None
def pages(info):
    if not info or not info["mem"]:
        return 0
    to = max(1 << info["align"], 16)
    return -(-(info["mem"] + (to if to > 65536 else 0)) // 65536)
def side_modules():
    seen = {}
    todo = [os.path.realpath(m.__file__) for m in list(sys.modules.values()) if (getattr(m, "__file__", None) or "").endswith(".so")]
    while todo:
        p = todo.pop()
        if p in seen:
            continue
        info = dylink(p)
        seen[p] = pages(info)
        d = os.path.dirname(p)
        for n in (info or {}).get("needed", []):
            for s in [d] + [r.replace("$ORIGIN", d).replace("$" "{ORIGIN}", d) for r in info["rpath"]]:
                c = os.path.join(s, n)
                if os.path.isfile(c):
                    todo.append(os.path.realpath(c))
                    break
    return sum(seen.values()) * 65536, len(seen)
out = {"linked": linked(os.path.join(sys.base_prefix, "bin", "python.wasm")), "start": libc.sbrk(0)}
keep = [bytearray(256 << 10) for _ in range(192)]
out["malloc48"] = libc.sbrk(0)
del keep
import numpy, pandas, scipy.optimize, scipy.integrate, scipy.linalg, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot
out["imports"] = libc.sbrk(0)
out["side"], out["modules"] = side_modules()
keep = []
while libc.sbrk(0) == out["imports"] and len(keep) < 512:
    keep.append(bytearray(1 << 20))
out["free"] = (len(keep) - 1) << 20
del keep
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
  if (o.side <= 0 || o.modules < 50) problems.push(`found ${o.modules} side modules with ${mib(o.side)} of data after the imports: the accounting found nothing to account for`);
  if (o.imports - o.start > o.side) problems.push(`the imports grew the memory from ${mib(o.start)} to ${mib(o.imports)}, more than the ${mib(o.side)} of the ${o.modules} side modules' data the loader places above it: the heap did not stay in the initial memory`);
  if (o.free < 48 * MIB) problems.push(`after the imports ${mib(o.free)} of 1 MiB buffers fit before the memory grows, want at least 48 MiB`);
  assert.deepEqual(problems, [], `heap-size: ${problems.join('; ')}`);
  console.log(`heap-size: python.wasm links ${mib(o.linked)}; memory ${mib(o.start)} at start, ${mib(o.malloc48)} after 48 MiB of mallocs (no memory.grow); importing numpy, pandas, scipy and matplotlib takes it to ${mib(o.imports)}: ${mib(o.imports - o.start)} of growth for the ${mib(o.side)} of data of ${o.modules} side modules (the loader grows the memory for each), the heap stays in the initial memory, and ${mib(o.free)} more of 1 MiB buffers fit before the memory grows (${mib(INITIAL - o.free)} in use)`);
}
