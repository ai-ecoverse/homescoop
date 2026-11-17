// API mode (out-of-line): share/py-cffi/selftest/_cffi_selftest is a cffi
// extension built the way a downstream recipe builds one (PyNaCl's _sodium,
// cryptography's _openssl): selftest/build_selftest.py ran on the build host
// through scripts/cffi-wasix.sh (cffi-emit.py, then wasixcc against
// wasix-python's headers). It imports _cffi_backend by name and calls
// _cffi_init with its ABI version, as theirs do.
const SCRIPT = String.raw`
import errno, gc, json, sys
sys.path.insert(0, "/node_modules/@ai-ecoverse/py-cffi/share/py-cffi/selftest")
import _cffi_backend
from _cffi_selftest import ffi, lib
out = {"ffi_type": type(ffi).__module__ + "." + type(ffi).__name__,
       "backend": _cffi_backend.__file__.rsplit("/", 1)[-1],
       "no_cffi_pkg": "cffi" not in sys.modules}
out["consts"] = [lib.SELFTEST_MAGIC, lib.selftest_answer, lib.RED, lib.GREEN, lib.BLUE]
# a struct with '...': the C compiler laid it out (pad first, y before x)
a = ffi.new("pt_t *", {"x": 2, "y": 3})
b = ffi.new("pt_t *", {"x": 4, "y": 5})
out["pt"] = [ffi.sizeof("pt_t"), ffi.offsetof("pt_t", "x"), ffi.offsetof("pt_t", "y"), lib.pt_dot(a[0], b[0])]
s = lib.pt_scale(a[0], 3)
out["scale"] = [s.x, s.y]
bf = ffi.new("struct buf *")
out["buf"] = [lib.buf_fill(bf, 0xAB), bf.len, bytes(bf.data[0:3]).hex()]
out["sum_ll"] = lib.sum_ll(ffi.new("long long[]", [2**40, 2**41, -5]), 3)
out["avg"] = lib.avg(ffi.new("double[]", [1.0, 2.0, 6.0]), 3)
# ffi.callback passed to C
@ffi.callback("int(int)")
def inc(x):
    return x + 7
out["call_twice"] = lib.call_twice(inc, 1)
# extern "Python": @ffi.def_extern, called from C
notes = []
@ffi.def_extern()
def py_hook(x):
    return x * x
@ffi.def_extern()
def py_note(msg):
    notes.append(ffi.string(msg).decode())
out["via_python"] = [lib.via_python(6), notes]
out["hello"] = ffi.string(lib.hello()).decode()
# errno set in C, read through ffi.errno
out["errno"] = [lib.errno_set(errno.ENOENT), ffi.errno == errno.ENOENT]
# ffi.gc on a malloc'd block
freed = []
p = ffi.gc(ffi.new("int[4]"), lambda q: freed.append(1))
del p; gc.collect()
out["gc"] = len(freed)
out["ctype"] = [ffi.getctype("pt_t *"), ffi.typeof(lib.pt_dot).kind]
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/cffi_api.py', SCRIPT);
  const r = await run(['python3', '/tmp/cffi_api.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.ffi_type, '_cffi_backend.FFI', o);
  assert.equal(out.backend, '_cffi_backend.cpython-315-wasm32-wasix.so', o);
  assert.equal(out.no_cffi_pkg, true, `a compiled module needs only _cffi_backend, not the cffi package: ${o}`);
  assert.deepEqual(out.consts, [0x5e1f, 42, 0, 5, 6], o);
  assert.deepEqual(out.pt, [12, 8, 4, 23], o);
  assert.deepEqual(out.scale, [6, 9], o);
  assert.deepEqual(out.buf, [16, 16, 'ababab'], o);
  assert.equal(out.sum_ll, 2 ** 40 + 2 ** 41 - 5, o);
  assert.equal(out.avg, 3, o);
  assert.equal(out.call_twice, 15, o);
  assert.deepEqual(out.via_python, [72, ['via_python']], o);
  assert.equal(out.hello, 'hello from C', o);
  assert.deepEqual(out.errno, [-1, true], o);
  assert.equal(out.gc, 1, o);
  assert.deepEqual(out.ctype, ['pt_t *', 'function'], o);
  console.log('cffi API mode: an out-of-line module built by scripts/cffi-wasix.sh imports with only _cffi_backend (no cffi package); integer constants, a static const, an enum; a "..." struct laid out by the C compiler, passed and returned by value; struct with an array; long long and double arrays; ffi.callback into C; extern "Python" through @ffi.def_extern; errno from C; ffi.gc');
}
