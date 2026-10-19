import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json
import numpy as np
from scipy import integrate, interpolate, linalg, optimize, sparse, special, stats, signal, fft
r = optimize.minimize(optimize.rosen, [1.3, 0.7, 0.8], method="BFGS", jac=optimize.rosen_der)
q, _ = integrate.quad(np.sin, 0, np.pi)
sol = integrate.solve_ivp(lambda t, y: -y, (0, 1), [1.0], rtol=1e-10, atol=1e-12)
a = np.array([[4.0, 3.0], [6.0, 3.0]])
p, l, u = linalg.lu(a)
m = sparse.csr_matrix(np.array([[1.0, 0, 2], [0, 3, 0], [4, 0, 5]]))
cs = interpolate.CubicSpline([0, 1, 2, 3], [0, 1, 8, 27])
b, af = signal.butter(2, 0.5)
out = {
    "rosen": [round(v, 5) + 0.0 for v in r.x.tolist()] + [bool(r.success)],
    "quad": round(q, 12),
    "ivp": round(float(sol.y[0, -1]), 8),
    "lu": bool(np.allclose(p @ l @ u, a)),
    "expm": round(float(linalg.expm(np.zeros((2, 2)))[0, 0]), 12),
    "sparse": (m @ np.array([1.0, 1.0, 1.0])).tolist(),
    "nnz": int(m.nnz),
    "gamma": float(special.gamma(5)),
    "erf": round(float(special.erf(0.5)), 9),
    "norm": [float(stats.norm.cdf(0)), round(float(stats.norm.ppf(0.975)), 6)],
    "ttest": round(float(stats.ttest_ind([1, 2, 3, 4], [2, 3, 4, 5]).pvalue), 6),
    "spline": round(float(cs(1.5)), 9),
    "butter": [round(v, 9) + 0.0 for v in b.tolist()],
    "fft": [round(abs(c), 9) for c in fft.fft([1.0, 0.0, -1.0, 0.0]).tolist()],
}
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/scipy_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/scipy_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.rosen, [1, 1, 1, true], o);
  assert.equal(out.quad, 2, o);
  assert.equal(out.ivp, 0.36787944, o);
  assert.equal(out.lu, true, o);
  assert.equal(out.expm, 1, o);
  assert.deepEqual(out.sparse, [3, 3, 9], o);
  assert.equal(out.nnz, 5, o);
  assert.equal(out.gamma, 24, o);
  assert.equal(out.erf, 0.520499878, o);
  assert.deepEqual(out.norm, [0.5, 1.959964], o);
  assert.equal(out.ttest, 0.315334, o);
  assert.equal(out.spline, 3.375, o);
  assert.deepEqual(out.butter, [0.292893219, 0.585786438, 0.292893219], o);
  assert.deepEqual(out.fft, [0, 2, 0, 2], o);
  console.log(`scipy on wasix-python ${python}: optimize BFGS (rosen), quad, solve_ivp, linalg lu/expm, sparse csr, special, stats, CubicSpline, signal.butter, fft`);
}
