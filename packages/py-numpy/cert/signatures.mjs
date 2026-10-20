// homescoop#1083: seven C entry points that trapped with a wasm function
// signature mismatch (numpy-wasm-call-signatures.patch): five private/test
// ones and two public ones, copy.copy() of a numpy scalar and setting
// ndarray.dtype. Each now returns normally; build.sh fails on any mismatch.
const CASES = {
  scalar_input: 'import numpy as np; from numpy._core import _multiarray_umath as mu; print(mu._array_converter(1, np.arange(3)).scalar_input)',
  supports_unaligned: 'import numpy as np; m = np._core._multiarray_umath._get_castingimpl(type(np.dtype("f8")), type(np.dtype("f4"))); print(m._supports_unaligned)',
  get_castingimpl: 'import numpy as np; from numpy._core import _multiarray_umath as mu; print(type(mu._get_castingimpl(type(np.dtype("f8")), type(np.dtype("f4")))).__name__)',
  sfloat_reduce: 'from numpy._core._multiarray_umath import _get_sfloat_dtype; print(type(_get_sfloat_dtype()(1.0).__reduce__()).__name__)',
  format_float_g: 'from numpy._core import _multiarray_tests as t; print(t.format_float_OSprintf_g(1.5, 3))',
  scalar_copy: 'import copy, numpy as np; print(copy.copy(np.float64(1.5)))',
  dtype_setter: 'import warnings, numpy as np; warnings.simplefilter("ignore"); a = np.zeros(2, "f8"); a.dtype = np.int64; print(a.dtype)',
};

export default async function (ctx) {
  const { run, assert } = ctx;
  const out = {};
  for (const [k, c] of Object.entries(CASES)) {
    const r = await run(['python3', '-c', c], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${k}: rc=${r.status} ${r.stderr}`);
    out[k] = r.stdout.trim();
  }
  assert.deepEqual(out, { scalar_input: '(True, False)', supports_unaligned: 'True', get_castingimpl: '_BoundArrayMethod', sfloat_reduce: 'tuple', format_float_g: '1.5', scalar_copy: '1.5', dtype_setter: 'int64' }, JSON.stringify(out));
  console.log(`signatures (#1083): array_converter.scalar_input, _BoundArrayMethod._supports_unaligned, _get_castingimpl, sfloat __reduce__, format_float_OSprintf_g, copy.copy(np.float64) and the ndarray.dtype setter return: ${JSON.stringify(out)}`);
}
