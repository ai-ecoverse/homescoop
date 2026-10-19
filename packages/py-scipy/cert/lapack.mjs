// homescoop#211 A6: the code paths the int-ABI fixes touch, against
// @ai-ecoverse/wasix-openblas (C LAPACK, f2c int returns): f2py's _flapack/
// _fblas, cython_lapack/cython_blas, _batched_linalg, SuperLU (0006), ARPACK
// (arnaud, cfix), trlib (0009), HiGHS, the g77-ABI wrappers (complex dots).
import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json
import numpy as np
from scipy import linalg, sparse, optimize
from scipy.linalg import blas, lapack, cython_lapack, cython_blas
from scipy.sparse import linalg as sla
rng = np.random.default_rng(0)
a = rng.standard_normal((6, 6)); s = a @ a.T + 6 * np.eye(6); b = rng.standard_normal(6)
out = {}
out["solve"] = bool(np.allclose(s @ linalg.solve(s, b), b))
w, v = linalg.eigh(s); out["eigh"] = bool(np.allclose(s @ v, v * w))
u, sv, vt = linalg.svd(a); out["svd"] = bool(np.allclose((u * sv) @ vt, a))
q, r = linalg.qr(a); out["qr"] = bool(np.allclose(q @ r, a))
c = linalg.cholesky(s); out["cholesky"] = bool(np.allclose(c.T @ c, s))
x, *_ = linalg.lstsq(a[:, :4], b); out["lstsq"] = len(x) == 4
t, z = linalg.schur(a); out["schur"] = bool(np.allclose(z @ t @ z.T, a))
out["inv_batched"] = bool(np.allclose(linalg.inv(np.stack([s, 2 * s])) @ np.stack([s, s]), np.stack([np.eye(6), 0.5 * np.eye(6)])))
out["det"] = round(float(linalg.det(np.array([[2.0, 1.0], [1.0, 3.0]]))), 9)
out["zdotc"] = complex(blas.zdotc(np.array([1+1j, 2]), np.array([1j, 1]))).__repr__()
out["cdotu"] = complex(blas.cdotu(np.array([1+1j, 2], np.complex64), np.array([1j, 1], np.complex64))).__repr__()
lu, piv, info = lapack.dgetrf(s); out["dgetrf_info"] = int(info)
out["dgesv"] = int(lapack.dgesv(s, b)[-1])
out["error"] = None
try:
    linalg.cholesky(-np.eye(3))
except linalg.LinAlgError as e:
    out["error"] = type(e).__name__
m = sparse.random(40, 40, density=0.2, random_state=1, format="csc") + sparse.eye(40, format="csc") * 4
lu_ = sla.splu(m); xb = rng.standard_normal(40)
out["splu"] = bool(np.allclose(m @ lu_.solve(xb), xb))
out["spilu"] = sla.spilu(m).shape == (40, 40)
lap = sparse.diags([-1, 2, -1], [-1, 0, 1], shape=(30, 30), format="csr")
vals = sla.eigsh(lap, k=3, which="LM", return_eigenvectors=False)
out["eigsh"] = [round(float(v), 6) for v in sorted(vals)]
out["eigs"] = len(sla.eigs(lap.astype(float), k=2, which="LM", return_eigenvectors=False)) == 2
out["svds"] = len(sla.svds(lap.astype(float), k=2, return_singular_vectors=False)) == 2
res = optimize.minimize(optimize.rosen, [1.3, 0.7, 0.8, 1.9, 1.2], method="trust-krylov", jac=optimize.rosen_der, hess=optimize.rosen_hess)
out["trust_krylov"] = [round(v, 4) + 0.0 for v in res.x.tolist()]
lp = optimize.linprog([-1, -2], A_ub=[[1, 1], [1, -1]], b_ub=[4, 2], bounds=[(0, None), (0, None)], method="highs")
out["linprog"] = [round(v, 6) + 0.0 for v in lp.x.tolist()] + [round(lp.fun, 6)]
out["milp"] = round(float(optimize.milp(c=[-1, -1], integrality=[1, 1], constraints=optimize.LinearConstraint([[2, 1], [1, 2]], ub=[7, 7])).fun), 6)
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await pythonUnderTest(ctx);
  await write('/tmp/scipy_lapack.py', SCRIPT);
  const r = await run(['python3', '/tmp/scipy_lapack.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  for (const k of ['solve', 'eigh', 'svd', 'qr', 'cholesky', 'lstsq', 'schur', 'inv_batched', 'splu', 'spilu', 'eigs', 'svds']) assert.equal(out[k], true, `${k}: ${o}`);
  assert.equal(out.det, 5, o);
  assert.equal(out.zdotc, '(3+1j)', o);
  assert.equal(out.cdotu, '(1+1j)', o);
  assert.equal(out.dgetrf_info, 0, o);
  assert.equal(out.dgesv, 0, o);
  assert.equal(out.error, 'LinAlgError', o);
  // the three largest of tridiag(-1, 2, -1), n = 30: 2 + 2 cos(k pi / 31), k = 3, 2, 1
  assert.deepEqual(out.eigsh, [3.908279, 3.95906, 3.989739], o);
  assert.deepEqual(out.trust_krylov, [1, 1, 1, 1, 1], o);
  assert.deepEqual(out.linprog, [0, 4, -8], o);
  assert.equal(out.milp, -4, o);
  console.log(`lapack: solve/eigh/svd/qr/cholesky/lstsq/schur, batched inv, det, zdotc/cdotu (g77 wrappers), dgetrf/dgesv, LinAlgError, splu/spilu (SuperLU), eigsh/eigs/svds (ARPACK), trust-krylov (trlib), linprog/milp (HiGHS): ${o}`);
}
