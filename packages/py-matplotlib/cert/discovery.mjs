import { repin } from '../../wasix-python/cert/fixtures/repin.mjs';
import { assertRepinned } from './lib/repinned.mjs';

const S = '@ai-ecoverse';
const NM = `/node_modules/${S}`;
const G = '/usr/local/share/pnpm/global/v11';
const TOP = ['py-numpy', 'py-pandas', 'py-scipy', 'py-matplotlib'];
const DIAG = String.raw`
import os, sys
import _slicc_site as s
base = os.path.abspath(sys.base_prefix); real = os.path.realpath(base)
print("base", base, "real", real)
print("py-* on sys.path:", [p for p in sys.path if "/py-" in p])
c = os.path.join(real, ".slicc-site-cache")
print("cache:", repr(open(c).read()[:4000]) if os.path.exists(c) else "none")
found = [p for nm in [s._project_node_modules(base)] for p in s._packages(nm)]
print("found:", found)
print("stamps:", [s._stamp(p) for p in found][:6])
print("scan:", s._scan(real, found))
`;
// pandas 3 (the cp315 line) no longer depends on pytz, so no top-level
// package pulls it in.
const IMPORTS =
  'import numpy, pandas, scipy.optimize, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot, PIL, kiwisolver, contourpy, fontTools, cycler, packaging, pyparsing, dateutil, six, tzdata; print(numpy.__version__, pandas.__version__, scipy.__version__, matplotlib.__version__)';

export default async function (ctx) {
  const { run, write, read, assert } = ctx;
  await assertRepinned(ctx);
  const sh = async (cmd) => {
    const r = await run(['bash', '-c', `set -e\n${cmd}`], { cwd: '/' });
    assert.equal(r.status, 0, `${cmd.slice(0, 200)}: ${r.stderr}`);
    return r.stdout;
  };
  const py = (args, env = {}) => run(['python', ...args], { cwd: '/home', env });
  const pkgs = (await sh(`ls ${NM}`)).split('\n').filter((n) => n.startsWith('py-'));
  const man = {};
  for (const n of ['wasix-python', ...pkgs]) man[n] = JSON.parse(await read(`${NM}/${n}/package.json`));
  const PYVER = man['wasix-python'].version;
  const deps = (n) => Object.keys(man[n].dependencies || {}).map((d) => d.replace(`${S}/`, '')).filter((d) => man[d]);
  const closure = (n, acc = new Set()) => {
    for (const d of deps(n)) if (d !== 'wasix-python' && !acc.has(d)) { acc.add(d); closure(d, acc); }
    return acc;
  };
  const entry = (n, v) => `${S}+${n}@${v ?? man[n].version}`;
  const project = async (dir, direct, all, stub = {}) => {
    const real = {};
    const cmds = [];
    for (const n of all) {
      real[n] = `${dir}/node_modules/.pnpm/${entry(n)}/node_modules/${S}/${n}`;
      const m = { ...man[n] };
      if (n === 'wasix-python') m.slicc = { ...m.slicc, commands: { 'python-g': m.slicc.commands.python } };
      await write(`${real[n]}/package.json`, JSON.stringify(m));
      cmds.push(`for c in $(ls -A ${NM}/${n}); do case "$c" in package.json|.slicc*) ;; *) ln -s ${NM}/${n}/$c ${real[n]}/$c ;; esac; done`);
    }
    for (const [n, v] of Object.entries(stub)) {
      real[n] = `${dir}/node_modules/.pnpm/${entry(n, v)}/node_modules/${S}/${n}`;
      await write(`${real[n]}/package.json`, JSON.stringify({ name: `${S}/${n}`, version: v }));
    }
    for (const n of all) {
      for (const d of deps(n)) {
        if (real[d]) cmds.push(`ln -s ${rel(real[n].replace(/\/[^/]+$/, ''), real[d])} ${real[n].replace(/\/[^/]+$/, '')}/${d}`);
      }
    }
    for (const n of direct) cmds.push(`mkdir -p ${dir}/node_modules/${S} && ln -s ${rel(`${dir}/node_modules/${S}`, real[n])} ${dir}/node_modules/${S}/${n}`);
    await write(`${dir}/package.json`, JSON.stringify({ dependencies: Object.fromEntries(direct.map((n) => [`${S}/${n}`, man[n]?.version ?? stub[n]])) }));
    await sh(cmds.join('\n'));
  };
  const pyg = (args) => run(['python-g', ...args], { cwd: '/home', env: {} });
  const pythonGAt = async (want) => {
    for (let i = 0; i < 100; i++) {
      const r = await pyg(['-c', 'import sys; print(sys.base_prefix)']);
      if (r.status === 0 && r.stdout.includes(want)) return;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.fail(`python-g is not ${want}`);
  };

  const nested = (await sh(`ls -d ${NM}/py-*/node_modules/${S}/wasix-python 2>/dev/null || true`)).split('\n').filter(Boolean);
  const stale = [];
  for (const dir of nested) {
    const v = JSON.parse(await read(`${dir}/package.json`)).version;
    if (v !== PYVER) stale.push([dir.slice(NM.length + 1).split('/')[0], v]);
  }
  if (stale.length) {
    const v = await py(['-v', '-c', 'pass']);
    const notes = v.stderr.split('\n').filter((l) => l.startsWith('slicc discover:'));
    for (const [pkg, ver] of stale) {
      assert.ok(notes.some((l) => l.includes(`${S}/${pkg} `) && l.includes(`built for wasix-python ${ver}, this is ${PYVER}`)), `${pkg} (python ${ver}) not refused: ${notes.join(' | ')}`);
    }
    console.log(`discovery: refused before re-pin: ${stale.map(([p, v]) => `${p} (wasix-python ${v})`).join(', ')}`);
  }
  const pins = await repin(ctx);
  assert.deepEqual(pins.moved, [], 'nothing to stand in for: the py-* are re-pinned');
  let r;
  try {
    await flatAndCost();
  } catch (e) {
    await pins.restore();
    throw e;
  }
  async function flatAndCost() {
  r = await py(['-c', IMPORTS]);
  if (r.status !== 0) {
    const why = await py(['-c', DIAG]);
    const v = await py(['-v', '-c', 'import numpy']);
    const notes = v.stderr.split('\n').filter((l) => l.startsWith('slicc discover')).join('\n');
    assert.fail(`flat: ${r.stderr}\n--- state:\n${why.stdout}${why.stderr}\n--- python -v -c 'import numpy': rc=${v.status}\n${notes}`);
  }
  console.log(`discovery: flat /node_modules: ${r.stdout.trim()}`);

  const pp = (await py(['-c', 'import sys; print(":".join(p for p in sys.path if "/py-" in p))'])).stdout.trim();
  const cold = await py(['-c', 'import os, time, _slicc_site as s\nc = os.path.join(os.path.realpath(__import__("sys").base_prefix), ".slicc-site-cache")\nos.path.exists(c) and os.remove(c)\nt = time.perf_counter(); s.discover(); a = time.perf_counter() - t\nt = time.perf_counter(); s.discover(); b = time.perf_counter() - t\nprint(f"{a*1000:.1f} {b*1000:.1f}")']);
  assert.equal(cold.status, 0, cold.stderr);
  const [coldMs, warmMs] = cold.stdout.trim().split(' ').map(Number);
  const times = { on: [], off: [], pythonpath: [] };
  const modes = [['on', {}], ['off', { SLICC_PYTHON_DISCOVER: '0' }], ['pythonpath', { SLICC_PYTHON_DISCOVER: '0', PYTHONPATH: pp }]];
  for (let i = 0; i < 9; i++) {
    for (const [m, env] of i % 2 ? modes : [...modes].reverse()) {
      const t = performance.now();
      assert.equal((await py(['-c', 'pass'], env)).status, 0);
      times[m].push(performance.now() - t);
    }
  }
  const med = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
  console.log(
    `discovery: discover() cold ${coldMs} ms, warm ${warmMs} ms; python -c pass median of 9: ` +
      `on ${med(times.on).toFixed(0)} ms, off ${med(times.off).toFixed(0)} ms, off + same PYTHONPATH ${med(times.pythonpath).toFixed(0)} ms`,
  );
  assert.ok(warmMs <= 0.2 * med(times.off), `warm discover() took ${warmMs} ms of a ${med(times.off).toFixed(0)} ms start`);
  assert.ok(med(times.on) <= med(times.pythonpath) * 1.1, 'discovery costs more than the same PYTHONPATH');
  }

  try {
    const one = new Set(['wasix-python', ...TOP]);
    for (const t of TOP) closure(t, one);
    await project(`${G}/one`, ['wasix-python', ...TOP], [...one]);
    await pythonGAt(`${G}/one/`);
    r = await pyg(['-c', IMPORTS]);
    assert.equal(r.status, 0, `one project: ${r.stderr}`);
    r = await pyg(['-c', 'import numpy, sys; print(numpy.__file__)']);
    assert.ok(r.stdout.startsWith(`${G}/one/`), `numpy came from ${r.stdout}`);
    console.log(`discovery: one pnpm project: numpy from ${r.stdout.trim()}`);
    await sh(`rm -rf ${G}`);

    await project(`${G}/python`, ['wasix-python'], ['wasix-python']);
    const placed = new Set();
    for (const t of TOP) {
      const all = [t, ...closure(t)].filter((n) => !placed.has(n));
      all.forEach((n) => placed.add(n));
      await project(`${G}/${t}`, [t], all, { 'wasix-python': PYVER });
    }
    // The cp315 line: an older revision of this python's ABI (3.15.0-0), so
    // discovery's revision check (not the ABI check) is what skips it.
    const old = `${G}/py-old/node_modules/.pnpm/${S}+py-oldbuild@1.0.0-1/node_modules/${S}/py-oldbuild`;
    await write(`${old}/package.json`, JSON.stringify({
      name: `${S}/py-oldbuild`, version: '1.0.0-1', dependencies: { [`${S}/wasix-python`]: '3.15.0-0' },
      slicc: { python: { sitePackages: 'lib/python3.15/site-packages', requires: { abi: 'cp315', platform: 'wasix_wasm32' } } },
    }));
    await write(`${old}/lib/python3.15/site-packages/oldbuild_marker.py`, 'X = 1\n');
    await write(`${old.replace(/py-oldbuild$/, 'wasix-python')}/package.json`, JSON.stringify({ name: `${S}/wasix-python`, version: '3.15.0-0' }));
    await sh(`mkdir -p ${G}/py-old/node_modules/${S} && ln -s ../.pnpm/${S}+py-oldbuild@1.0.0-1/node_modules/${S}/py-oldbuild ${G}/py-old/node_modules/${S}/py-oldbuild\nln -s python ${G}/0123abcdef`);
    await pythonGAt(`${G}/python/`);
    // homescoop#1358: one call per step, each well under the harness's 120 s
    // per-call limit, with the durations logged: a cold discover() over the
    // per-package projects first, then the imports in groups.
    const steps = [['discover', 'pass'], ['numpy+pandas', 'import numpy, pandas'], ['scipy', 'import scipy.optimize'],
      ['matplotlib', 'import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot, PIL, kiwisolver, contourpy'], ['all', IMPORTS]];
    const took = [];
    for (const [name, code] of steps) {
      const t = performance.now();
      r = await pyg(['-c', code]);
      took.push(`${name} ${Math.round(performance.now() - t)} ms`);
      assert.equal(r.status, 0, `global projects, ${name}: ${r.stderr}`);
    }
    console.log(`discovery: pnpm add -g steps: ${took.join(', ')}`);
    r = await pyg(['-c', 'import numpy, pandas; print(numpy.__file__, pandas.__file__)']);
    assert.ok(r.stdout.includes(`${G}/py-numpy/`) && r.stdout.includes(`${G}/py-pandas/`), `from ${r.stdout}`);
    console.log(`discovery: pnpm add -g, one project each: ${r.stdout.trim()}`);
    r = await pyg(['-v', '-c', 'import importlib.util as u; print(u.find_spec("oldbuild_marker") is None)']);
    const note = r.stderr.split('\n').filter((l) => l.startsWith('slicc discover:') && l.includes('py-oldbuild'));
    assert.equal(r.stdout.trim(), 'True', 'a py-* built for wasix-python 3.15.0-0 (an older revision of this ABI) was put on sys.path');
    assert.ok(note.length === 1 && note[0].includes('3.15.0-0'), `-v note: ${note}`);
    console.log(`discovery: other python's py-* skipped: ${note[0]}`);
  } finally {
    await sh(`rm -rf ${G}`);
    await pins.restore();
  }
}

function rel(fromDir, to) {
  const a = fromDir.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}
