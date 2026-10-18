/**
 * wasix-python 3.14.2-16: ctypes calls to variadic C functions.
 *
 * ctypes uses ffi_prep_cif_var when argtypes names the fixed parameters and
 * a call passes more arguments (CPython's callproc.c; the same rule as on
 * Apple arm64). wasix-org/libffi's WASIX backend refused that (FFI_BAD_ABI,
 * "ffi_prep_cif_var failed" in 3.14.2-15); patches/libffi-wasix-varargs.patch
 * passes the variadic arguments the way clang's wasm32 C ABI does: one extra
 * i32, a pointer to a buffer holding them at their natural alignment.
 * Mixed int / double / long long checks the padding; twelve variadic
 * arguments check a buffer larger than a few slots. Floats: C promotes a
 * variadic float to double, ctypes does not. Pass c_double for %f. As on
 * every platform, an explicit c_float is rejected by libffi itself
 * (ffi_prep_cif_var: FFI_BAD_ARGTYPE for a variadic float), so ctypes raises
 * RuntimeError "ffi_prep_cif_var failed", and a bare Python float has no
 * conversion beyond argtypes (ArgumentError "Don't know how to convert").
 */
const SCRIPT = String.raw`
import ctypes, fcntl, json, os, sys
libc = ctypes.CDLL(None)
out = {}

buf = ctypes.create_string_buffer(128)
libc.snprintf.argtypes = [ctypes.c_char_p, ctypes.c_size_t, ctypes.c_char_p]
libc.snprintf.restype = ctypes.c_int
n = libc.snprintf(buf, 128, b"%d|%.3f|%lld|%s|%d", ctypes.c_int(42), ctypes.c_double(3.14159),
                  ctypes.c_longlong(1234567890123), b"str", ctypes.c_int(-7))
out["snprintf"] = [n, buf.value.decode()]

libc.sscanf.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
i, d = ctypes.c_int(), ctypes.c_double()
out["sscanf"] = [libc.sscanf(b"17 2.5", b"%d %lf", ctypes.byref(i), ctypes.byref(d)), i.value, d.value]

libc.open.argtypes = [ctypes.c_char_p, ctypes.c_int]
os.umask(0o022)
fd = libc.open(b"/tmp/ctypes-varargs", os.O_CREAT | os.O_WRONLY | os.O_TRUNC, ctypes.c_int(0o640))
out["open"] = [fd >= 0, oct(os.stat("/tmp/ctypes-varargs").st_mode & 0o777)]
os.close(fd)

libc.fcntl.argtypes = [ctypes.c_int, ctypes.c_int]
fd = os.open("/tmp/ctypes-varargs", os.O_RDONLY)
out["fcntl"] = [libc.fcntl(fd, fcntl.F_SETFD, ctypes.c_int(fcntl.FD_CLOEXEC)), libc.fcntl(fd, fcntl.F_GETFD, ctypes.c_int(0)) & fcntl.FD_CLOEXEC]
os.close(fd)

n = libc.snprintf(buf, 128, b"%d,%d,%d,%d,%d,%d,%.1f,%lld,%d,%s,%d,%d",
                  *[ctypes.c_int(k) for k in range(1, 7)], ctypes.c_double(7.5), ctypes.c_longlong(8 << 40),
                  ctypes.c_int(9), b"ten", ctypes.c_int(11), ctypes.c_int(12))
out["twelve"] = [n, buf.value.decode()]
libc.snprintf(buf, 128, b"%f|%.2f", ctypes.c_double(1.25), ctypes.c_double(2.5))
out["double"] = buf.value.decode()
try:
    libc.snprintf(buf, 128, b"%f", 1.25)
    out["py_float"] = "accepted: " + buf.value.decode()
except ctypes.ArgumentError as e:
    out["py_float"] = "ArgumentError: " + str(e)
try:
    libc.snprintf(buf, 128, b"%f", ctypes.c_float(1.25))
    out["c_float"] = "accepted: " + buf.value.decode()
except RuntimeError as e:
    out["c_float"] = "RuntimeError: " + str(e)

sys.stdout.flush()
libc.printf.argtypes = [ctypes.c_char_p]
libc.printf(b"printf: %s %d %.1f %f\n", b"pf", ctypes.c_int(7), ctypes.c_double(0.5), ctypes.c_double(0.25))
libc.fflush(None)
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/home/ctypes_varargs.py', SCRIPT);
  const r = await run(['python', '/home/ctypes_varargs.py'], { cwd: '/home' });
  assert.equal(r.status, 0, `ctypes_varargs.py: rc=${r.status}\n${r.stdout}\n${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines[0], 'printf: pf 7 0.5 0.250000', r.stdout);
  const o = JSON.parse(lines[1]);
  assert.deepEqual(o.snprintf, [29, '42|3.142|1234567890123|str|-7']);
  assert.deepEqual(o.sscanf, [2, 17, 2.5]);
  assert.deepEqual(o.open, [true, '0o640']);
  assert.deepEqual(o.fcntl, [0, 1]);
  assert.deepEqual(o.twelve, [41, `1,2,3,4,5,6,7.5,${8 * 2 ** 40},9,ten,11,12`]);
  assert.equal(o.double, '1.250000|2.50');
  assert.equal(o.c_float, 'RuntimeError: ffi_prep_cif_var failed', 'a variadic c_float is rejected (libffi FFI_BAD_ARGTYPE), not mis-passed');
  assert.match(o.py_float, /^ArgumentError: argument 4: TypeError: Don't know how to convert parameter 4$/, o.py_float);
  console.log(`ctypes-varargs: ${lines[0]}; snprintf ${JSON.stringify(o.snprintf)}; 12 varargs ${JSON.stringify(o.twelve)}; %f ${o.double}; c_float → ${o.c_float}; bare float → ArgumentError; sscanf, open 0640, fcntl ok`);
}
