import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json
import numpy as np
a = np.array([[3.0, 1.0, 2.0], [1.0, 4.0, 1.0], [2.0, 1.0, 5.0]])
b = np.array([11.0, 12.0, 19.0])
x = np.linalg.solve(a, b)
w = np.linalg.eigvalsh(np.array([[2.0, 1.0], [1.0, 2.0]]))
m = np.arange(12, dtype=np.float64).reshape(3, 4)
f = np.fft.fft(np.array([1.0, 2.0, 3.0, 4.0]))
g = np.random.default_rng(42)
out = {
    "solve": [round(v, 9) + 0.0 for v in x.tolist()],
    "residual": float(np.abs(a @ x - b).max()),
    "det": round(float(np.linalg.det(a)), 9),
    "inv": bool(np.allclose(np.linalg.inv(a) @ a, np.eye(3))),
    "eigvalsh": [round(v, 9) + 0.0 for v in w.tolist()],
    "matmul": (m @ m.T).tolist(),
    "einsum": float(np.einsum("ij,ij->", m, m)),
    "fft": [[round(c.real, 9) + 0.0, round(c.imag, 9) + 0.0] for c in f.tolist()],
    "rng": g.integers(0, 1000, 5).tolist(),
    "sort": np.sort(np.array([3, 1, 2], dtype=np.int64)).tolist(),
    "stats": [float(m.mean()), float(m.std()), int(m.argmax())],
    "dtype": str((np.int32(7) * np.float32(0.5)).dtype),
}
from importlib.metadata import distribution
eps = distribution("numpy").entry_points
out["entry_points"] = sorted(f"{e.group}:{e.name}={e.value}" for e in eps)
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/numpy_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/numpy_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.solve, [1, 2, 3], o);
  assert.ok(out.residual < 1e-12, o);
  assert.equal(out.det, 40, o);
  assert.equal(out.inv, true, o);
  assert.deepEqual(out.eigvalsh, [1, 3], o);
  assert.deepEqual(out.matmul, [[14, 38, 62], [38, 126, 214], [62, 214, 366]], o);
  assert.equal(out.einsum, 506, o);
  assert.deepEqual(out.fft, [[10, 0], [-2, 2], [-2, 0], [-2, -2]], o);
  assert.deepEqual(out.sort, [1, 2, 3], o);
  assert.deepEqual(out.stats, [5.5, Math.sqrt(143 / 12), 11], o);
  assert.equal(out.dtype, 'float64', o);
  assert.deepEqual(out.rng, [89, 773, 654, 438, 433], o);
  // numpy 2.5.4's pyproject.toml entry points (#1084).
  assert.deepEqual(out.entry_points, ['array_api:numpy=numpy', 'console_scripts:f2py=numpy.f2py.f2py2e:main', 'console_scripts:numpy-config=numpy._configtool:main', 'pkg_config:numpy=numpy._core.lib.pkgconfig', 'pyinstaller40:hook-dirs=numpy:_pyinstaller_hooks_dir'], o);
  console.log(`numpy on wasix-python ${python}: linalg solve/det/inv/eigvalsh (OpenBLAS), matmul, einsum, fft, default_rng ${JSON.stringify(out.rng)}`);
}
