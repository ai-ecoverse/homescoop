const SCRIPT = String.raw`
import json
import numpy as np
import contourpy
import contourpy.util
def attempt(f):
    try:
        f()
        return "ok"
    except Exception as e:
        return [type(e).__name__, str(e)]
z = np.arange(16.0).reshape(4, 4)
g = contourpy.contour_generator(z=z, name="threaded", thread_count=2, chunk_count=2)
out = {
    "shape": attempt(lambda: contourpy.contour_generator(np.zeros((2, 2)), np.zeros((3, 3)), np.zeros((3, 3)))),
    "name": attempt(lambda: contourpy.contour_generator(z=z, name="nope")),
    "levels": attempt(lambda: contourpy.contour_generator(z=z).filled(2.0, 1.0)),
    "threaded": [len(g.lines(5.0)), g.thread_count >= 1, g.chunk_count],
    "build": contourpy.util.build_config()["contourpy_version"],
}
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/contourpy_errors.py', SCRIPT);
  const r = await run(['python3', '/tmp/contourpy_errors.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `C++ exceptions must cross pybind11 as Python exceptions, not trap: rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.shape, ['TypeError', 'Shapes of x (2, 2) and z (3, 3) do not match'], o);
  assert.deepEqual(out.name, ['ValueError', 'Unrecognised contour generator name: nope'], o);
  assert.equal(out.levels[0], 'ValueError', o);
  assert.deepEqual(out.threaded, [2, true, [2, 2]], o);
  assert.equal(out.build, '1.4.0', o);
  console.log(`contourpy: C++ exceptions thrown in _contourpy reach Python through pybind11 (TypeError for mismatched shapes, ValueError for a bad name and for upper < lower levels), the threaded generator with 2 chunks gives ${out.threaded[0]} lines, build_config() works`);
}
