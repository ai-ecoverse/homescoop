/**
 * The paths py-numpy's patches change (cert/meta.json "patches"; #727, #1080):
 * - numpy-wasm-fp-exceptions.patch: lowlevel_strided_loops' float casts, among
 *   them longdouble -> clongdouble, whose strict-FP form crashed LLVM 21;
 * - numpy-cblas-int-returns.patch: cblas_cdotu_sub/cdotc_sub/zdotu_sub/zdotc_sub
 *   as int-returning (OpenBLAS's signature; wasm checks it), reached by
 *   np.dot/np.vdot on complex vectors;
 * - numpy-wasix-no-backtrace.patch: the temporary-elision check that would
 *   call backtrace() (a + b + c on large float64 arrays), and no backtrace
 *   import in _multiarray_umath.
 */
import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json, glob, os
import numpy as np
out = {}
ld = np.array([1.5, -2.25, 3.0], dtype=np.longdouble)
out["ld_to_cld"] = [[float(c.real), float(c.imag)] for c in ld.astype(np.clongdouble)]
out["f16_to_ld"] = np.array([0.5, 2.0], dtype=np.float16).astype(np.longdouble).astype(np.float64).tolist()
out["f32_to_f64"] = np.array([1.25, -4.5], dtype=np.float32).astype(np.float64).tolist()
out["f64_to_f16"] = np.array([0.25, 8.0], dtype=np.float64).astype(np.float16).astype(np.float64).tolist()
out["ld_to_i8"] = np.array([7.9, -3.2], dtype=np.longdouble).astype(np.int8).tolist()
c64 = np.array([1 + 2j, 3 - 1j], dtype=np.complex64)
c128 = np.array([2 + 0.5j, -1 + 4j], dtype=np.complex128)
out["dotu64"] = [float(v) for v in (lambda z: (z.real, z.imag))(np.dot(c64, c64[::-1]))]
out["dotc64"] = [float(v) for v in (lambda z: (z.real, z.imag))(np.vdot(c64, c64[::-1]))]
out["dotu128"] = [float(v) for v in (lambda z: (z.real, z.imag))(np.dot(c128, c128[::-1]))]
out["dotc128"] = [float(v) for v in (lambda z: (z.real, z.imag))(np.vdot(c128, c128[::-1]))]
n = 1 << 18
a = np.full(n, 1.0); b = np.full(n, 2.0); c = np.full(n, 3.0)
s = a + b + c
out["elision"] = [float(s[0]), float(s[-1]), int(s.size)]
so = glob.glob(os.path.join(os.path.dirname(np._core.__file__), "_multiarray_umath*.so"))[0]
out["backtrace_import"] = b"backtrace" in open(so, "rb").read()
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/numpy_patches.py', SCRIPT);
  const r = await run(['python3', '/tmp/numpy_patches.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.ld_to_cld, [[1.5, 0], [-2.25, 0], [3, 0]], `fp-exceptions: longdouble -> clongdouble: ${o}`);
  assert.deepEqual(out.f16_to_ld, [0.5, 2], o);
  assert.deepEqual(out.f32_to_f64, [1.25, -4.5], o);
  assert.deepEqual(out.f64_to_f16, [0.25, 8], o);
  assert.deepEqual(out.ld_to_i8, [7, -3], o);
  // (1+2j)(3-1j) + (3-1j)(1+2j) = 2*(5+5j); conj(1+2j)(3-1j) + conj(3-1j)(1+2j) = (1-7j) + (1+7j)
  assert.deepEqual(out.dotu64, [10, 10], `cblas_cdotu_sub: ${o}`);
  assert.deepEqual(out.dotc64, [2, 0], `cblas_cdotc_sub: ${o}`);
  // (2+0.5j)(-1+4j) twice = 2*(-4+7.5j); conj(2+0.5j)(-1+4j) + conj(-1+4j)(2+0.5j) = (0+8.5j) + (0-8.5j)
  assert.deepEqual(out.dotu128, [-8, 15], `cblas_zdotu_sub: ${o}`);
  assert.deepEqual(out.dotc128, [0, 0], `cblas_zdotc_sub: ${o}`);
  assert.deepEqual(out.elision, [6, 6, 1 << 18], `temporary elision (no backtrace): ${o}`);
  assert.equal(out.backtrace_import, false, `_multiarray_umath names backtrace: ${o}`);
  console.log(`numpy patches on wasix-python ${python}: longdouble/float16/float32 casts incl. longdouble -> clongdouble; complex dot/vdot through cblas_[cz]dot[uc]_sub; a + b + c on 2^18 float64 (temporary elision) and no backtrace in _multiarray_umath`);
}
