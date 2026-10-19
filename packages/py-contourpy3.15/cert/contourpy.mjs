import { pythonUnderTest } from '../../../scripts/browser-cert/py-import.mjs';

const SCRIPT = String.raw`
import json
import numpy as np
import contourpy
x, y = np.meshgrid(np.linspace(-1, 1, 41), np.linspace(-1, 1, 41))
z = x * x + y * y
gen = contourpy.contour_generator(x, y, z, name="serial", line_type="Separate", fill_type="OuterCode")
lines = gen.lines(0.25)
pts = lines[0]
r = np.sqrt((pts ** 2).sum(axis=1))
fill = gen.filled(0.25, 0.5)
print(json.dumps({
    "nlines": len(lines),
    "closed": bool(np.allclose(pts[0], pts[-1])),
    "radius": [round(float(r.min()), 3), round(float(r.max()), 3)],
    "npoints": int(len(pts)),
    "nfill": len(fill[0]),
    "mpl2014": len(contourpy.contour_generator(x, y, z, name="mpl2014").lines(0.25)) > 0,
}))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const python = await pythonUnderTest(ctx);
  await write('/tmp/contourpy_use.py', SCRIPT);
  const r = await run(['python3', '/tmp/contourpy_use.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.nlines, 1, o);
  assert.equal(out.closed, true, o);
  assert.ok(out.radius[0] >= 0.49 && out.radius[1] <= 0.501, `the 0.25 level of x^2 + y^2 is the circle r = 0.5: ${o}`);
  assert.ok(out.npoints > 40, o);
  assert.equal(out.nfill, 1, o);
  assert.equal(out.mpl2014, true, o);
  console.log(`contourpy on wasix-python ${python}: serial lines of x^2 + y^2 at 0.25 are one closed circle (r ${out.radius.join('..')}, ${out.npoints} points), filled 0.25..0.5, mpl2014`);
}
