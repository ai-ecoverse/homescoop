// numpy on wasm32, pinned so a change either way shows (homescoop#1081, #1093).
// - #1093: ILP32, so np.intp and numpy's default integer are int32 (desktop:
//   int64); dtype=np.int64 is the workaround and must keep working.
// - #1081: WebAssembly has no FP status flags, so numpy reports no FP errors:
//   no RuntimeWarning, errstate(all="raise") never raises (results are right:
//   inf/nan). LinAlgError is separate and works (linalg-errors.mjs, #1082).
// Both are documented in the README ("On wasm32").
import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json, warnings
import numpy as np
out = {}
out["intp"] = np.dtype(np.intp).itemsize
out["default_int"] = [str(np.array([1]).dtype), str(np.arange(3).dtype)]
out["int64_sum"] = int(np.arange(70000, dtype=np.int64).sum())
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter("always")
    r = [float(np.array([1.0])[0] / np.array([0.0])[0]), float(np.sqrt(np.array([-1.0]))[0])]
    out["fp_results"] = [str(r[0]), str(r[1])]
    out["fp_warnings"] = len([x for x in w if issubclass(x.category, RuntimeWarning)])
try:
    with np.errstate(all="raise"):
        np.array([1.0]) / np.array([0.0])
    out["errstate_raise"] = "no exception"
except FloatingPointError:
    out["errstate_raise"] = "FloatingPointError"
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await pythonUnderTest(ctx);
  await write('/tmp/numpy_wasm32.py', SCRIPT);
  const r = await run(['python3', '/tmp/numpy_wasm32.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.intp, 4, o);
  assert.deepEqual(out.default_int, ['int32', 'int32'], o);
  assert.equal(out.int64_sum, 2449965000, o);
  assert.deepEqual(out.fp_results, ['inf', 'nan'], o);
  assert.equal(out.fp_warnings, 0, `documented: no FP warnings on wasm (#1081): ${o}`);
  assert.equal(out.errstate_raise, 'no exception', `documented: errstate(raise) can't raise on wasm (#1081): ${o}`);
  console.log(`wasm32: np.intp is 4 bytes and the default int int32 (#1093), dtype=np.int64 sums past 2**31; division by zero and sqrt(-1) give inf/nan with no RuntimeWarning, errstate(all="raise") doesn't raise (#1081): ${o}`);
}
