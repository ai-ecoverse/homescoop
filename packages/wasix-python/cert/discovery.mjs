/**
 * wasix-python 3.14.2-15: py-* packages are found without PYTHONPATH
 * (_slicc_site.discover(), from site-packages/slicc-executable.pth).
 *
 * The harness installs python and the py-* flat in /node_modules (npm
 * layout); sidemods.mjs runs on that without PYTHONPATH. Here the same
 * package directories are moved (mv, so no copies) into pnpm 12 layouts
 * under slicc-kernel's PNPM_HOME, which the kernel scans for commands
 * (global/v<N>/<project>/node_modules), and moved back at the end:
 *   1. one project (a local `pnpm add` / one global project): python + numpy,
 *      pandas, scipy, matplotlib direct, the other py-* only in .pnpm;
 *   2. `pnpm add -g` of each: one project per package, the way pnpm 12 does
 *      it even for one command; each py-* project's own wasix-python is a
 *      package.json stand-in of the same version (pnpm would copy all of it);
 *      plus a py-* built for wasix-python 3.14.2-13, which must not be
 *      picked up (and -v says why);
 * and the cost: discover() cold (scan) and warm (cache), python -c pass with
 * discovery on, off, and off with the same directories on PYTHONPATH.
 */
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
const IMPORTS =
  'import numpy, pandas, scipy.optimize, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot, PIL, kiwisolver, contourpy, fontTools, cycler, packaging, pyparsing, dateutil, pytz, six, tzdata; print(numpy.__version__, pandas.__version__, scipy.__version__, matplotlib.__version__)';

export default async function (ctx) {
  const { run, write, read, assert } = ctx;
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
  const moved = []; // [from, to] to undo
  // A pnpm project at `dir`: real dirs .pnpm/<entry>/node_modules/@s/<n>,
  // dependency links beside them, top-level links for `direct`.
  // stub: { name: version } stand-ins (package.json only).
  const project = async (dir, direct, all, stub = {}) => {
    const real = {};
    const cmds = [];
    for (const n of all) {
      real[n] = `${dir}/node_modules/.pnpm/${entry(n)}/node_modules/${S}/${n}`;
      cmds.push(`mkdir -p ${real[n].replace(/\/[^/]+$/, '')} && mv ${NM}/${n} ${real[n]}`);
      moved.push([`${NM}/${n}`, real[n]]);
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
  const restore = async () => {
    const back = moved.splice(0).reverse().map(([from, to]) => `mv ${to} ${from}`);
    await sh([...back, `rm -rf ${G}`].join('\n'));
  };
  // python resolves to the moved interpreter once the kernel's watcher rescans.
  const pythonAt = async (want) => {
    for (let i = 0; i < 50; i++) {
      const r = await py(['-c', 'import sys; print(sys.base_prefix)']);
      if (r.status === 0 && r.stdout.includes(want)) return;
      await new Promise((res) => setTimeout(res, 100));
    }
    assert.fail(`python did not move to ${want}`);
  };

  // 0. The harness's flat npm layout, no PYTHONPATH.
  let r = await py(['-c', IMPORTS]);
  if (r.status !== 0) {
    // What discovery saw: sys.path, the cache, and a rescan (-v skips the cache).
    const why = await py(['-c', DIAG]);
    const v = await py(['-v', '-c', 'import numpy']);
    const notes = v.stderr.split('\n').filter((l) => l.startsWith('slicc discover')).join('\n');
    assert.fail(`flat: ${r.stderr}\n--- state:\n${why.stdout}${why.stderr}\n--- python -v -c 'import numpy': rc=${v.status}\n${notes}`);
  }
  console.log(`discovery: flat /node_modules: ${r.stdout.trim()}`);

  // Cost, on the flat layout (17 py-*).
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
  assert.ok(warmMs < 10, `warm discover() took ${warmMs} ms`);
  assert.ok(med(times.on) <= med(times.pythonpath) * 1.1, 'discovery costs more than the same PYTHONPATH');

  try {
    // 1. One pnpm project.
    const one = new Set(['wasix-python', ...TOP]);
    for (const t of TOP) closure(t, one);
    await project(`${G}/one`, ['wasix-python', ...TOP], [...one]);
    await pythonAt(`${G}/one/`);
    r = await py(['-c', IMPORTS]);
    assert.equal(r.status, 0, `one project: ${r.stderr}`);
    console.log(`discovery: one pnpm project: ${r.stdout.trim()}`);
    await restore();
    await pythonAt(`${NM}/wasix-python`);

    // 2. One project per `pnpm add -g` package.
    await project(`${G}/python`, ['wasix-python'], ['wasix-python']);
    const placed = new Set();
    for (const t of TOP) {
      const all = [t, ...closure(t)].filter((n) => !placed.has(n));
      all.forEach((n) => placed.add(n));
      await project(`${G}/${t}`, [t], all, { 'wasix-python': PYVER });
    }
    // Another python's py-*: a stand-in with one module.
    const old = `${G}/py-old/node_modules/.pnpm/${S}+py-oldbuild@1.0.0-1/node_modules/${S}/py-oldbuild`;
    await write(`${old}/package.json`, JSON.stringify({
      name: `${S}/py-oldbuild`, version: '1.0.0-1', dependencies: { [`${S}/wasix-python`]: '3.14.2-13' },
      slicc: { python: { sitePackages: 'lib/python3.14/site-packages', requires: { abi: 'cp314', platform: 'wasix_wasm32' } } },
    }));
    await write(`${old}/lib/python3.14/site-packages/oldbuild_marker.py`, 'X = 1\n');
    await write(`${old.replace(/py-oldbuild$/, 'wasix-python')}/package.json`, JSON.stringify({ name: `${S}/wasix-python`, version: '3.14.2-13' }));
    await sh(`mkdir -p ${G}/py-old/node_modules/${S} && ln -s ../.pnpm/${S}+py-oldbuild@1.0.0-1/node_modules/${S}/py-oldbuild ${G}/py-old/node_modules/${S}/py-oldbuild\nln -s python ${G}/0123abcdef`);
    await pythonAt(`${G}/python/`);
    r = await py(['-c', IMPORTS]);
    assert.equal(r.status, 0, `global projects: ${r.stderr}`);
    console.log(`discovery: pnpm add -g, one project each: ${r.stdout.trim()}`);
    r = await py(['-v', '-c', 'import importlib.util as u; print(u.find_spec("oldbuild_marker") is None)']);
    const note = r.stderr.split('\n').filter((l) => l.startsWith('slicc discover:') && l.includes('py-oldbuild'));
    assert.equal(r.stdout.trim(), 'True', 'a py-* built for wasix-python 3.14.2-13 was put on sys.path');
    assert.ok(note.length === 1 && note[0].includes('3.14.2-13'), `-v note: ${note}`);
    console.log(`discovery: other python's py-* skipped: ${note[0]}`);
  } finally {
    await restore();
    await pythonAt(`${NM}/wasix-python`);
  }
}

function rel(fromDir, to) {
  const a = fromDir.split('/').filter(Boolean);
  const b = to.split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}
