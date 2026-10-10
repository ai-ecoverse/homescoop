/**
 * wasix-python `_ctypes` (homescoop#110, slicc-kernel#306).
 *
 * Needs a kernel with wasix_32v1 `call_dynamic`, `closure_{allocate,free,prepare}`,
 * and POSIX `dlopen(NULL)` = the loaded main (non-NULL handle, main in `byPath`).
 * That first release is `engines` / `cert/meta.json` `kernel`. On 1.49.0 alone,
 * `import ctypes` raises OSError (see NEGATIVE.md).
 *
 * Fixture: cert/fixtures/libside-add.so (wasixcc PIC dylink side module,
 * `int side_add(int,int)`), embedded as base64 so the browser-cert write path
 * cannot UTF-8-corrupt the wasm bytes.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SIDE_B64 = readFileSync(join(here, 'fixtures/libside-add.so')).toString('base64');

const SCRIPT = `
import base64, json, sys, _ctypes

open("/home/libside-add.so", "wb").write(base64.b64decode(${JSON.stringify(SIDE_B64)}))

out = {"_ctypes": _ctypes.__name__}

# import ctypes + CDLL(None) + PyDLL of the command path must not load a second
# python.wasm (byPath miss). Interpreter-state call proves pythonapi is live.
import ctypes
out["ctypes"] = ctypes.__name__
ctypes.pythonapi.Py_IsInitialized.restype = ctypes.c_int
out["Py_IsInitialized"] = ctypes.pythonapi.Py_IsInitialized()
ctypes.pythonapi.PyLong_FromLong.restype = ctypes.py_object
out["PyLong_FromLong"] = int(ctypes.pythonapi.PyLong_FromLong(12345))

lib = ctypes.CDLL(None)
lib.strlen.argtypes = [ctypes.c_char_p]
lib.strlen.restype = ctypes.c_size_t
out["strlen"] = lib.strlen(b"wasix")

# PyDLL(sys.executable) is often /usr/bin/python (not a wasm); skip if not a module.
# The decisive "no second PIE" checks are Py_IsInitialized + PyLong_FromLong above.
try:
    ctypes.PyDLL(sys.executable)
    out["PyDLL_executable"] = "ok"
except OSError as e:
    out["PyDLL_executable"] = f"skip:{e}"

side = ctypes.CDLL("/home/libside-add.so")
side.side_add.argtypes = [ctypes.c_int, ctypes.c_int]
side.side_add.restype = ctypes.c_int
out["side_add"] = side.side_add(3, 4)

# #306 step 2: closure_prepare
CB = ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_int)
@CB
def _inc(x):
    return x + 1
out["cfunc"] = _inc(41)

print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/home/ctypes_check.py', SCRIPT);
  const r = await run(['python', '/home/ctypes_check.py'], { cwd: '/home' });
  assert.equal(r.status, 0, `ctypes_check.py: rc=${r.status}\n${r.stdout}\n${r.stderr}`);
  const o = JSON.parse(r.stdout.trim());
  assert.equal(o._ctypes, '_ctypes');
  assert.equal(o.ctypes, 'ctypes');
  assert.equal(
    o.Py_IsInitialized,
    1,
    `pythonapi must be the running main, not a second PIE load (got ${o.Py_IsInitialized})`,
  );
  assert.equal(o.PyLong_FromLong, 12345);
  assert.equal(o.strlen, 5);
  assert.equal(o.side_add, 7);
  assert.equal(o.cfunc, 42);
  console.log(
    `ctypes: ok Py_IsInitialized=${o.Py_IsInitialized} PyLong_FromLong=${o.PyLong_FromLong} ` +
      `strlen=${o.strlen} side_add=${o.side_add} cfunc=${o.cfunc}`,
  );
}
