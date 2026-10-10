/**
 * wasix-python `_ctypes` (homescoop#110, slicc-kernel#306 step 1).
 *
 * Needs a kernel that implements wasix_32v1 `call_dynamic` and
 * `closure_{allocate,free}`: CPython 3.14's `_ctypes_mod_exec` always does
 * `Py_ffi_closure_alloc` at import. Step 1 alone: import + CDLL. CFUNCTYPE /
 * closures wait for #306 step 2.
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
import base64, ctypes, _ctypes, json, sys
open("/home/libside-add.so", "wb").write(base64.b64decode(${JSON.stringify(SIDE_B64)}))
out = {"_ctypes": _ctypes.__name__, "ctypes": ctypes.__name__}
# Main-module libc symbols (PIE export-dynamic).
lib = ctypes.CDLL(None)
lib.strlen.argtypes = [ctypes.c_char_p]
lib.strlen.restype = ctypes.c_size_t
out["strlen"] = lib.strlen(b"wasix")
# Side module via dlopen + ffi_call (call_dynamic).
side = ctypes.CDLL("/home/libside-add.so")
side.side_add.argtypes = [ctypes.c_int, ctypes.c_int]
side.side_add.restype = ctypes.c_int
out["side_add"] = side.side_add(3, 4)
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
  assert.equal(o.strlen, 5);
  assert.equal(o.side_add, 7);
  console.log(`ctypes: import ok, strlen=${o.strlen}, side_add=${o.side_add}`);
}
