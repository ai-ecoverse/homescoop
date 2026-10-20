// wasix-openblas 0.3.34-1: eigh (dsyevd) and SVD (dgesdd) for n > 25, where
// LAPACK's divide and conquer runs laed3/laed4 (0.3.34 declared them void
// against the f2c int ABI and trapped until wasix-openblas fixed it, #1173).
import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json
import numpy as np
rng = np.random.default_rng(7)
out = {}
for n in (26, 64, 200):
    a = rng.standard_normal((n, n)); s = a + a.T
    w, v = np.linalg.eigh(s)
    u, sv, vt = np.linalg.svd(a)
    out[n] = [bool(np.allclose(s @ v, v * w, atol=1e-8)), bool(np.allclose((u * sv) @ vt, a, atol=1e-8)),
              bool(np.allclose(np.linalg.eigvalsh(s), w)), bool(np.all(np.diff(sv) <= 1e-12))]
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await pythonUnderTest(ctx);
  await write('/tmp/numpy_linalg_large.py', SCRIPT);
  const r = await run(['python3', '/tmp/numpy_linalg_large.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const n of ['26', '64', '200']) assert.deepEqual(out[n], [true, true, true, true], `n=${n}: ${JSON.stringify(out)}`);
  console.log(`linalg-large: eigh, svd and eigvalsh of 26x26, 64x64 and 200x200 matrices reconstruct (dsyevd/dgesdd divide and conquer on wasix-openblas): ${JSON.stringify(out)}`);
}
