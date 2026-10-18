/**
 * numpy.linalg raises LinAlgError for a failed factorisation (homescoop#1082):
 * a singular solve and inv, a non-positive-definite cholesky. A good matrix
 * still solves (the control). Up to 2.3.2-11 wasm's missing FP status flags
 * made errstate miss LAPACK's failure, and these returned NaN.
 */
import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json
import numpy as np
out = {}
def attempt(name, f):
    try:
        r = f()
        out[name] = ["ok", bool(np.isnan(np.asarray(r)).any())]
    except np.linalg.LinAlgError as e:
        out[name] = ["LinAlgError", str(e)]
S = np.array([[1.0, 2.0], [2.0, 4.0]])
attempt("solve_singular", lambda: np.linalg.solve(S, np.array([1.0, 2.0])))
attempt("inv_singular", lambda: np.linalg.inv(S))
attempt("inv_singular_f32", lambda: np.linalg.inv(S.astype(np.float32)))
attempt("inv_singular_c128", lambda: np.linalg.inv(S.astype(np.complex128)))
attempt("cholesky_nonpd", lambda: np.linalg.cholesky(np.array([[1.0, 2.0], [2.0, 1.0]])))
attempt("inv_batch_one_singular", lambda: np.linalg.inv(np.stack([np.eye(2), S])))
A = np.array([[3.0, 1.0], [1.0, 2.0]])
x = np.linalg.solve(A, np.array([9.0, 8.0]))
out["solve_good"] = [round(v, 9) + 0.0 for v in x.tolist()]
out["inv_good"] = bool(np.allclose(np.linalg.inv(A) @ A, np.eye(2)))
out["cholesky_good"] = bool(np.allclose(np.linalg.cholesky(A) @ np.linalg.cholesky(A).T, A))
# A failure doesn't leak into the next call.
out["after_failure"] = [round(v, 9) + 0.0 for v in np.linalg.solve(A, np.array([9.0, 8.0])).tolist()]
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/numpy_linalg_errors.py', SCRIPT);
  const r = await run(['python3', '/tmp/numpy_linalg_errors.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  for (const k of ['solve_singular', 'inv_singular', 'inv_singular_f32', 'inv_singular_c128', 'inv_batch_one_singular']) {
    assert.deepEqual(out[k], ['LinAlgError', 'Singular matrix'], `${k}: ${o}`);
  }
  assert.deepEqual(out.cholesky_nonpd, ['LinAlgError', 'Matrix is not positive definite'], o);
  assert.deepEqual(out.solve_good, [2, 3], o);
  assert.equal(out.inv_good, true, o);
  assert.equal(out.cholesky_good, true, o);
  assert.deepEqual(out.after_failure, [2, 3], o);
  console.log(`numpy.linalg on wasix-python ${python}: singular solve/inv (float64, float32, complex128, one of a batch) raise LinAlgError('Singular matrix'), a non-PD cholesky raises LinAlgError('Matrix is not positive definite'); a good matrix solves to [2, 3] before and after a failure`);
}
