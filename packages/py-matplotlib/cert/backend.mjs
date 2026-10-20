// homescoop#1115: the default backend is Agg, set at build time
// (meson -DrcParams-backend=Agg writes the packager line "#backend: Agg" into
// mpl-data/matplotlibrc, tools/generate_matplotlibrc.py; the default is the
// inert "##backend: Agg"), not auto-resolved through the GUI candidates.
export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['python3', '-c', 'import matplotlib, re; rc = open(matplotlib.matplotlib_fname()).read(); print(matplotlib.rcParams._get_backend_or_none(), bool(re.search(r"^#backend: Agg$", rc, re.M)), matplotlib.get_backend())'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stderr}`);
  assert.equal(r.stdout.trim(), 'Agg True Agg', r.stdout);
  console.log(`backend (#1115): rcParams backend before pyplot is Agg, matplotlibrc has the packager line "#backend: Agg", get_backend() Agg`);
}
