/**
 * wasix-python 3.14.2-12: every published py-* package (the versions pinned
 * in test/side-modules.json and cert/meta.json needsInstall) imports and
 * works on this interpreter, so -12 stays ABI-compatible with their native
 * side modules (test/side-abi.mjs checks the imports statically at build).
 * Smoke: numpy linalg + fft, pandas groupby + read_csv, scipy optimize +
 * integrate, matplotlib Agg savefig PNG, PIL open/resize/save, kiwisolver,
 * contourpy; the pure-Python packages import. Since 3.14.2-15 without
 * PYTHONPATH: _slicc_site.discover() finds them in /node_modules.
 */
const PKGS = ['py-numpy', 'py-pandas', 'py-scipy', 'py-matplotlib', 'py-contourpy', 'py-kiwisolver', 'py-pillow',
  'py-fonttools', 'py-cycler', 'py-packaging', 'py-pyparsing', 'py-python-dateutil', 'py-pytz', 'py-six', 'py-tzdata'];

const SCRIPT = String.raw`
import io, json
out = {}
import numpy as np
a = np.array([[3.0, 1.0], [1.0, 2.0]]); x = np.linalg.solve(a, np.array([9.0, 8.0]))
f = np.fft.fft(np.array([1.0, 0.0, -1.0, 0.0]))
out["numpy"] = [np.__version__, x.round(6).tolist(), np.abs(f).round(6).tolist(), float(np.linalg.det(a))]
import pandas as pd
df = pd.read_csv(io.StringIO("k,v\na,1\nb,2\na,3\n"))
out["pandas"] = [pd.__version__, df.groupby("k")["v"].sum().to_dict()]
import scipy
from scipy import optimize, integrate
r = optimize.minimize(optimize.rosen, [1.3, 0.7], method="BFGS")
q, _ = integrate.quad(lambda t: t * t, 0, 3)
out["scipy"] = [scipy.__version__, [round(v, 4) for v in r.x], round(q, 6)]
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(2, 2), dpi=50); ax.plot([0, 1, 2], [0, 1, 4]); fig.savefig("/tmp/plot.png")
out["matplotlib"] = [matplotlib.__version__, open("/tmp/plot.png", "rb").read(8) == b"\x89PNG\r\n\x1a\n"]
from PIL import Image
im = Image.open("/tmp/plot.png"); small = im.resize((10, 10)); small.save("/tmp/small.png")
out["pillow"] = [im.size, Image.open("/tmp/small.png").size]
# kiwisolver: py-kiwisolver 1.5.1-1's METH_NOARGS methods (value(),
# updateVariables(), ...) trap with a signature mismatch on -11 as well
# (homescoop#197); construct and add constraints only.
import kiwisolver as kiwi
s = kiwi.Solver(); v1, v2 = kiwi.Variable("a"), kiwi.Variable("b")
s.addConstraint(v1 + v2 == 10); s.addConstraint(v1 - v2 == 2)
out["kiwisolver"] = [kiwi.__version__, str(v1 == 3)]
import contourpy
z = np.array([[0.0, 1.0], [1.0, 2.0]]); lines = contourpy.contour_generator(z=z).lines(1.0)
out["contourpy"] = [len(lines) > 0]
import fontTools.ttLib, cycler, packaging.version, pyparsing, dateutil.parser, pytz, six, tzdata
out["pure"] = [str(packaging.version.Version("1.2.3")), dateutil.parser.isoparse("2026-10-10T12:00:00").year,
               str(pytz.timezone("Europe/Berlin")), six.PY3]
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const sites = PKGS.map((p) => `/node_modules/@ai-ecoverse/${p}/lib/python3.14/site-packages`).join(':');
  await write('/home/sidemods_check.py', SCRIPT);
  const r = await run(['python', '/home/sidemods_check.py'], { cwd: '/home', env: { PYTHONPATH: sites, MPLBACKEND: 'Agg' } });
  assert.equal(r.status, 0, `sidemods_check.py: rc=${r.status}\n${r.stdout}\n${r.stderr}`);
  const o = JSON.parse(r.stdout);
  console.log(`sidemods: numpy ${o.numpy[0]}, pandas ${o.pandas[0]}, scipy ${o.scipy[0]}, matplotlib ${o.matplotlib[0]}`);
  assert.deepEqual(o.numpy.slice(1, 3), [[2, 3], [0, 2, 0, 2]]);
  assert.ok(Math.abs(o.numpy[3] - 5) < 1e-9, `det ${o.numpy[3]}`);
  assert.deepEqual(o.pandas[1], { a: 4, b: 2 });
  assert.deepEqual(o.scipy.slice(1), [[1, 1], 9]);
  assert.equal(o.matplotlib[1], true);
  assert.deepEqual(o.pillow, [[100, 100], [10, 10]]);
  assert.deepEqual(o.kiwisolver, ['1.5.1', '1 * a + -3 == 0 | strength = 1.001e+09 (VIOLATED)']);
  assert.deepEqual(o.contourpy, [true]);
  assert.deepEqual(o.pure, ['1.2.3', 2026, 'Europe/Berlin', true]);
}
