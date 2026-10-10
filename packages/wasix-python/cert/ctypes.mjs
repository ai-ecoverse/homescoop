/**
 * wasix-python `_ctypes` (homescoop#110, slicc-kernel#306 / PR #316).
 *
 * Needs a kernel with wasix_32v1 `call_dynamic`, `closure_{allocate,free,prepare}`,
 * and POSIX `dlopen(NULL)` = the loaded main (non-NULL handle, main in `byPath`).
 * That first release is `engines` / `cert/meta.json` `kernel`. On 1.49.0 alone,
 * `import ctypes` raises OSError (see NEGATIVE.md).
 *
 * "No second PIE": WASIX has no /proc for VmSize; use libc `sbrk(0)` (wasm
 * memory size). Calibrate with a 64 MiB malloc. Pattern from adq's #316 check.
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
import base64, json, os, sys, _ctypes

open("/home/libside-add.so", "wb").write(base64.b64decode(${JSON.stringify(SIDE_B64)}))

out = {"_ctypes": _ctypes.__name__}

import ctypes
out["ctypes"] = ctypes.__name__

libc = ctypes.CDLL(None)
libc.sbrk.restype = ctypes.c_size_t
libc.sbrk.argtypes = [ctypes.c_ssize_t]
sbrk0 = lambda: libc.sbrk(0)
out["sbrk_after_import"] = sbrk0()

ctypes.pythonapi.Py_IsInitialized.restype = ctypes.c_int
out["Py_IsInitialized"] = ctypes.pythonapi.Py_IsInitialized()
ctypes.pythonapi.PyLong_FromLong.restype = ctypes.py_object
out["PyLong_FromLong"] = int(ctypes.pythonapi.PyLong_FromLong(12345))
ctypes.pythonapi.Py_GetVersion.restype = ctypes.c_char_p
out["Py_GetVersion_ok"] = ctypes.pythonapi.Py_GetVersion().decode()[:6] == sys.version[:6]

libc.strlen.argtypes = [ctypes.c_char_p]
libc.strlen.restype = ctypes.c_size_t
out["strlen"] = libc.strlen(b"wasix")

ctypes.CDLL(None)
ctypes.PyDLL(None)
out["sbrk_after_cdll_none"] = sbrk0()

# byPath: same handle as the running main — no second instantiate.
me = ctypes.PyDLL(os.path.join(sys.base_prefix, "bin", "python.wasm"))
me.Py_IsInitialized.restype = ctypes.c_int
out["by_path_Py_IsInitialized"] = me.Py_IsInitialized()
out["sbrk_after_by_path"] = sbrk0()

# Calibrate: sbrk(0) must track a real grow (64 MiB malloc).
ctypes.create_string_buffer(64 << 20)
out["sbrk_after_64m"] = sbrk0()

side = ctypes.CDLL("/home/libside-add.so")
side.side_add.argtypes = [ctypes.c_int, ctypes.c_int]
side.side_add.restype = ctypes.c_int
out["side_add"] = side.side_add(3, 4)

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
  assert.equal(o.Py_GetVersion_ok, true);
  assert.equal(o.strlen, 5);
  assert.equal(
    o.by_path_Py_IsInitialized,
    1,
    'dlopen of bin/python.wasm by path must be the running main (byPath)',
  );
  const growNone = o.sbrk_after_by_path - o.sbrk_after_import;
  assert.ok(
    growNone < 1 << 20,
    `CDLL(None)/PyDLL(python.wasm) grew sbrk(0) by ${growNone} B (want < 1 MiB)`,
  );
  const growCal = o.sbrk_after_64m - o.sbrk_after_import;
  assert.ok(
    growCal >= 32 << 20,
    `sbrk(0) calibration: 64 MiB malloc grew only ${growCal} B (want ≥ 32 MiB)`,
  );
  assert.equal(o.side_add, 7);
  assert.equal(o.cfunc, 42);
  console.log(
    `ctypes: ok Py_IsInitialized=${o.Py_IsInitialized} by_path=${o.by_path_Py_IsInitialized} ` +
      `sbrk_grow_none=${growNone} sbrk_grow_64m=${growCal} ` +
      `strlen=${o.strlen} side_add=${o.side_add} cfunc=${o.cfunc}`,
  );
}
