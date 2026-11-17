// ABI mode (ffi.cdef + ffi.dlopen): cffi calls C through libffi, i.e. through
// python.wasm's libffi (wasix call_dynamic), and C calls Python back through
// libffi closures (cffi-wasix-closures.patch: closure_allocate/prepare).
// share/py-cffi/selftest/libcffi_selftest.so is a plain C side module.
const SCRIPT = String.raw`
import gc, json, os, sys
import cffi
ST = "/node_modules/@ai-ecoverse/py-cffi/share/py-cffi/selftest"
ffi = cffi.FFI()
ffi.cdef(open(os.path.join(ST, "cdef.h")).read())
lib = ffi.dlopen(os.path.join(ST, "libcffi_selftest.so"))
out = {}
# scalars of every width
out["scalars"] = [lib.st_add(40, 2), lib.st_neg8(5), lib.st_u16(65535), lib.st_mul64(3_000_000_000, 3),
                  lib.st_umax() == 2**64 - 1, lib.st_mix(0.5, 0.25, 3, 2**40), lib.st_halve(3.0), float(lib.st_ld(1.25))]
# pointers, arrays, strings
arr = ffi.new("int[]", [1, 2, 3, 4, 5])
out["sum"] = lib.st_sum(arr, len(arr))
buf = ffi.new("int[4]")
lib.st_fill(buf, 4, 10)
out["fill"] = list(buf)
out["strlen"] = lib.st_strlen(b"wasix")
cbuf = ffi.new("char[64]")
out["greet"] = ffi.string(lib.st_greet(b"slicc", cbuf, 64)).decode()
out["greet_null"] = lib.st_greet(b"slicc", cbuf, 4) == ffi.NULL
# structs by value both ways, by pointer, nested
p = lib.st_mkpoint(3, 4)
out["mkpoint"] = [p.x, p.y]
r = ffi.new("struct st_rect *", {"tl": {"x": 1, "y": 1}, "br": {"x": 4, "y": 5}, "scale": 2.0})
out["area"] = lib.st_area(r[0])
lib.st_grow(r, 1)
out["grow"] = [r.br.x, r.br.y, lib.st_area(r[0])]
r2 = lib.st_mkrect(lib.st_mkpoint(0, 0), {"x": 2, "y": 3}, 0.5)
out["mkrect"] = [r2.tl.x, r2.br.x, r2.br.y, r2.scale]
out["one"] = lib.st_one({"v": 1.5})
out["sizeof"] = [ffi.sizeof("struct st_rect"), ffi.offsetof("struct st_rect", "scale"), ffi.sizeof("long double"), ffi.sizeof("void *")]
# callbacks (libffi closures), several alive at once, with userdata
seen = []
@ffi.callback("int(int, void *)")
def times(i, ud):
    seen.append(i)
    return i * ffi.from_handle(ud)
k = 10
h = ffi.new_handle(k)
out["apply"] = lib.st_apply(times, 4, h)
out["seen"] = seen
plus = ffi.callback("double(double, double)", lambda a, b: a * b)
out["apply_d"] = lib.st_apply_d(plus, 1.5, 4.0)
def pt(pp):
    pp.x, pp.y = pp.y, pp.x * 10
    return 1
out["point_cb"] = lib.st_point_cb(ffi.callback("int(struct st_point *)", pt), 2, 3)
cmp = ffi.callback("int(const void *, const void *)", lambda a, b: ffi.cast("int *", b)[0] - ffi.cast("int *", a)[0])
nums = ffi.new("int[]", [5, 1, 4, 2, 3])
lib.st_sort(nums, 5, cmp)
out["sort_desc"] = list(nums)
@ffi.callback("int(int, void *)", error=-1)
def boom(i, ud):
    raise ValueError("boom")
out["cb_error"] = lib.st_apply(boom, 2, ffi.NULL)
# varargs (wasix-python's libffi varargs patch)
out["vsum"] = lib.st_vsum(4, ffi.cast("int", 1), ffi.cast("int", 2), ffi.cast("int", 3), ffi.cast("int", 4))
out["vmix"] = lib.st_vmix(b"ild", ffi.cast("int", 1), ffi.cast("long long", 2**33), ffi.cast("double", 0.5))
# globals
out["global"] = [lib.st_counter]
lib.st_counter = 99
out["global"].append(lib.st_counter)
# ffi.new / ffi.gc / ffi.buffer / ffi.from_buffer
before = lib.st_freed
mem = ffi.gc(lib.st_alloc(32), lib.st_free)
ffi.memmove(mem, b"abcdef", 6)
out["buffer"] = bytes(ffi.buffer(mem, 6)).decode()
del mem; gc.collect()
out["gc_freed"] = lib.st_freed - before
out["from_buffer"] = lib.st_sum(ffi.cast("int *", ffi.from_buffer("int[]", bytearray(b"\x07\x00\x00\x00\x08\x00\x00\x00"))), 2)
out["new_struct"] = ffi.new("struct st_point *", [7, 8]).y
# the C library and Python's own API in python.wasm: dlopen(None)
C = cffi.FFI()
C.cdef("size_t strlen(const char *); int snprintf(char *, size_t, const char *, ...); void qsort(void *, size_t, size_t, int (*)(const void *, const void *)); int Py_IsInitialized(void);")
libc = C.dlopen(None)
sb = C.new("char[64]")
n = libc.snprintf(sb, 64, b"%d-%s-%.2f", C.cast("int", 42), C.new("char[]", b"ok"), C.cast("double", 3.14159))
out["libc"] = [libc.strlen(b"hello"), C.string(sb).decode(), n, libc.Py_IsInitialized()]
qs = C.new("int[]", [3, 1, 2])
libc.qsort(qs, 3, C.sizeof("int"), C.callback("int(const void *, const void *)", lambda a, b: C.cast("int *", a)[0] - C.cast("int *", b)[0]))
out["qsort"] = list(qs)
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/cffi_abi.py', SCRIPT);
  const r = await run(['python3', '/tmp/cffi_abi.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.scalars, [42, -5, 0, 9_000_000_000, true, 0.5 + 0.25 + 3 + 2 ** 40, 1.5, 2.5], o);
  assert.equal(out.sum, 15, o);
  assert.deepEqual(out.fill, [10, 11, 12, 13], o);
  assert.equal(out.strlen, 5, o);
  assert.equal(out.greet, 'hello, slicc', o);
  assert.equal(out.greet_null, true, o);
  assert.deepEqual(out.mkpoint, [3, 4], o);
  assert.equal(out.area, 24, o);
  assert.deepEqual(out.grow, [5, 6, 40], o);
  assert.deepEqual(out.mkrect, [0, 2, 3, 0.5], o);
  assert.equal(out.one, 4.5, o);
  assert.deepEqual(out.sizeof, [24, 16, 16, 4], o);
  assert.equal(out.apply, 60, o);
  assert.deepEqual(out.seen, [0, 1, 2, 3], o);
  assert.equal(out.apply_d, 7, o);
  assert.equal(out.point_cb, 1 + 3 + 20, o);
  assert.deepEqual(out.sort_desc, [5, 4, 3, 2, 1], o);
  assert.equal(out.cb_error, -2, o);
  assert.equal(out.vsum, 10, o);
  assert.equal(out.vmix, 1 + 2 ** 33 + 0.5, o);
  assert.deepEqual(out.global, [7, 99], o);
  assert.equal(out.buffer, 'abcdef', o);
  assert.equal(out.gc_freed, 1, o);
  assert.equal(out.from_buffer, 15, o);
  assert.equal(out.new_struct, 8, o);
  assert.deepEqual(out.libc, [5, '42-ok-3.14', 10, 1], o);
  assert.deepEqual(out.qsort, [1, 2, 3], o);
  console.log('cffi ABI mode: ffi.dlopen of a C side module; int8..uint64, float, double, long double; arrays, strings, NULL; structs by value (args and returns, nested, one-field) and by pointer; callbacks into C with userdata, several alive, qsort, an exception (error=-1); varargs; a global read and written; ffi.new, ffi.gc (the destructor runs), ffi.buffer, ffi.from_buffer; dlopen(None): libc strlen/snprintf/qsort and Py_IsInitialized from python.wasm');
}
