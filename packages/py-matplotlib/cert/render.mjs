const RENDER = String.raw`
import io, json, os, datetime
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.tri as mtri
import numpy as np
import pandas as pd
out = {}
fig, ax = plt.subplots(figsize=(3, 2), dpi=50)
ax.plot([0, 1, 2], [0, 1, 4], label=r"$\alpha^2+\sqrt{x}$")
ax.set_title(r"$\int_0^1 x\,dx = \frac{1}{2}$")
ax.legend()
magic = {}
for fmt in ["svg", "pdf", "ps", "eps", "jpg", "png"]:
    buf = io.BytesIO()
    fig.savefig(buf, format=fmt)
    b = buf.getvalue()
    magic[fmt] = [len(b), b[:32].hex()]
    if fmt == "svg":
        magic[fmt].append(b"<svg" in b[:2048])
plt.close(fig)
out["magic"] = magic
from matplotlib.mathtext import MathTextParser
parsed = MathTextParser("path").parse(r"$\alpha^2 + \sqrt{\frac{a}{b}} + \sum_{i=0}^{n} i$", dpi=72)
buf = io.BytesIO()
matplotlib.mathtext.math_to_image(r"$\alpha\beta\gamma$", buf, dpi=72, format="png")
out["mathtext"] = [len(parsed.glyphs) > 5, bool(float(parsed.width) > 0), buf.getvalue()[:8].hex()]
gx, gy = np.meshgrid(np.linspace(0.0, 1.0, 5), np.linspace(0.0, 1.0, 5))
tri = mtri.Triangulation(gx.ravel(), gy.ravel())
fig, ax = plt.subplots(figsize=(2, 2), dpi=50)
z = np.hypot(tri.x - 0.5, tri.y - 0.5)
tcf = ax.tricontourf(tri, z, levels=4)
fig.savefig("/tmp/render_tri.png")
plt.close(fig)
interp = mtri.LinearTriInterpolator(tri, tri.x + tri.y)
out["tri"] = [len(tri.triangles), tri.edges.shape[0], len(tcf.levels) >= 4, round(float(interp(0.3, 0.4)), 6), open("/tmp/render_tri.png", "rb").read(8).hex()]
days = [datetime.datetime(2026, 10, d) for d in range(1, 11)]
fig, ax = plt.subplots(figsize=(3, 2), dpi=50)
ax.plot(days, list(range(10)))
fig.canvas.draw()
lo, hi = ax.get_xlim()
out["dates"] = [type(ax.xaxis.get_major_locator()).__name__, mdates.num2date(lo).strftime("%Y-%m"), mdates.num2date(hi).strftime("%Y-%m"), any(t.get_text() for t in ax.get_xticklabels())]
plt.close(fig)
df = pd.DataFrame({"a": np.arange(6.0), "b": np.arange(6.0) ** 2}, index=pd.date_range("2026-10-01", periods=6, freq="D"))
ax = df.plot(figsize=(3, 2))
ax.figure.canvas.draw()
ax.figure.savefig("/tmp/render_pandas.png", dpi=50)
labels = [t.get_text() for t in ax.get_xticklabels() if t.get_text()]
bars = pd.Series([3, 1, 2], index=["x", "y", "z"]).plot.bar()
out["pandas"] = [len(ax.get_lines()), [l.get_label() for l in ax.get_lines()], len(labels) > 0, len(bars.patches), open("/tmp/render_pandas.png", "rb").read(8).hex()]
print(json.dumps(out))
`;

const CONFIG = String.raw`
import json, os, sys, glob, warnings
warnings.simplefilter("always")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(2, 2), dpi=50)
ax.set_title("cache")
fig.savefig("/tmp/mplcfg_%d.png" % os.getuid())
d = matplotlib.get_configdir()
c = matplotlib.get_cachedir()
st = os.stat(d)
print(json.dumps([os.getuid(), sys.platform, d, c, st.st_uid, sorted(os.path.basename(p) for p in glob.glob(os.path.join(c, "fontlist-v*.json")))]))
`;

const PNG = '89504e470d0a1a0a';

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/render_check.py', RENDER);
  const r = await run(['python3', '/tmp/render_check.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `render_check.py: rc=${r.status}\n${r.stdout}\n${r.stderr}`);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  const j = JSON.stringify(o);
  const starts = (fmt, hex) => assert.ok(o.magic[fmt][1].startsWith(hex) && o.magic[fmt][0] > 200, `${fmt}: ${JSON.stringify(o.magic[fmt])}`);
  starts('svg', Buffer.from('<?xml').toString('hex'));
  assert.equal(o.magic.svg[2], true, `svg has an <svg> root: ${j}`);
  starts('pdf', Buffer.from('%PDF-').toString('hex'));
  starts('ps', Buffer.from('%!PS-Adobe-3.0').toString('hex'));
  starts('eps', Buffer.from('%!PS-Adobe-3.0 EPSF').toString('hex'));
  starts('jpg', 'ffd8ff');
  starts('png', PNG);
  assert.deepEqual(o.mathtext, [true, true, PNG], `mathtext: ${j}`);
  assert.deepEqual(o.tri, [32, 56, true, 0.7, PNG], `qhull Triangulation + tricontourf: ${j}`);
  assert.deepEqual(o.dates, ['AutoDateLocator', '2026-09', '2026-10', true], `date axis: ${j}`);
  assert.deepEqual(o.pandas, [2, ['a', 'b'], true, 3, PNG], `pandas .plot(): ${j}`);

  await ctx.addUser({ name: 'mira' });
  await write('/tmp/mplcfg_check.py', CONFIG);
  const home = await run(['python3', '/tmp/mplcfg_check.py'], { cwd: '/home/mira', user: 'mira' });
  assert.equal(home.status, 0, `as mira: rc=${home.status}\n${home.stdout}\n${home.stderr}`);
  assert.doesNotMatch(home.stderr, /temporary cache directory|is not a writable directory/, `as mira: ${home.stderr}`);
  const [uid, platform, cfg, cache, owner, fonts] = JSON.parse(home.stdout.trim().split('\n').pop());
  const h = JSON.stringify({ uid, platform, cfg, cache, owner, fonts });
  assert.notEqual(uid, 0, `mira runs as a non-root uid: ${h}`);
  assert.equal(cfg, '/home/mira/.matplotlib', `mira's config dir (sys.platform ${platform} is not linux, so no XDG dirs): ${h}`);
  assert.equal(cache, cfg, `mira's cache dir: ${h}`);
  assert.equal(owner, uid, `mira owns her config dir: ${h}`);
  assert.equal(fonts.length, 1, `mira's font cache is written: ${h}`);
  const env = await run(['python3', '/tmp/mplcfg_check.py'], { cwd: '/home/mira', user: 'mira', env: { MPLCONFIGDIR: '/tmp/mira-mpl' } });
  assert.equal(env.status, 0, `as mira with MPLCONFIGDIR: rc=${env.status}\n${env.stdout}\n${env.stderr}`);
  assert.doesNotMatch(env.stderr, /temporary cache directory|is not a writable directory/, `as mira with MPLCONFIGDIR: ${env.stderr}`);
  const [euid, , ecfg, ecache, eowner, efonts] = JSON.parse(env.stdout.trim().split('\n').pop());
  assert.deepEqual([ecfg, ecache, eowner, efonts.length], ['/tmp/mira-mpl', '/tmp/mira-mpl', euid, 1], `MPLCONFIGDIR=/tmp/mira-mpl holds the config, the cache and the font list: ${env.stdout}`);

  console.log(`render (#1263): savefig svg ${o.magic.svg[0]} B, pdf ${o.magic.pdf[0]} B, ps ${o.magic.ps[0]} B, eps ${o.magic.eps[0]} B, jpg ${o.magic.jpg[0]} B, png ${o.magic.png[0]} B with their magic bytes; mathtext parses and renders a PNG; qhull Triangulation of a 5x5 grid has 32 triangles and 56 edges, tricontourf saves a PNG, LinearTriInterpolator(0.3, 0.4) = ${o.tri[3]}; a datetime x axis gets ${o.dates[0]} over ${o.dates[1]}..${o.dates[2]}; pandas DataFrame.plot() on a date index draws ${o.pandas[0]} lines and Series.plot.bar() ${o.pandas[3]} bars; as uid ${uid} (mira, sys.platform ${platform}) the config and cache dir is ${cfg} with ${fonts[0]}, and MPLCONFIGDIR=/tmp/mira-mpl moves both`);
}
