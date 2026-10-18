/**
 * Which installed py-* this python can load (wasix-python 3.15.0-1,
 * homescoop#761).
 *
 * _slicc_site.discover() puts a py-* on sys.path only if its
 * slicc.python.requires (abi, platform) match this python's slicc.python, or
 * it has none (pure Python). The py-* published for CPython 3.14 require
 * cp314, so a cp315 python refuses them: their extension modules are
 * cpython-314-wasm32-wasix.so, which 3.15 neither looks for nor could link.
 * The specs that import py-* run their checks on the loadable ones and
 * assert that the others are refused cleanly (python -v names the reason,
 * import raises ModuleNotFoundError, nothing traps). On a python that
 * matches every installed py-* (the 3.14 line, or 3.15 after its py-* wave)
 * nothing is refused and the specs are what they were.
 */
const NM = '/node_modules/@ai-ecoverse';

export const MODULES = {
  'py-numpy': 'numpy',
  'py-pandas': 'pandas',
  'py-scipy': 'scipy',
  'py-matplotlib': 'matplotlib',
  'py-contourpy': 'contourpy',
  'py-kiwisolver': 'kiwisolver',
  'py-pillow': 'PIL',
  'py-fonttools': 'fontTools',
  'py-cycler': 'cycler',
  'py-packaging': 'packaging',
  'py-pyparsing': 'pyparsing',
  'py-python-dateutil': 'dateutil',
  'py-pytz': 'pytz',
  'py-six': 'six',
  'py-tzdata': 'tzdata',
};

export async function abiSplit({ run, read }) {
  const python = JSON.parse(await read(`${NM}/wasix-python/package.json`));
  const want = python.slicc.python;
  const ls = await run(['bash', '-c', `ls ${NM}`], { cwd: '/' });
  const loadable = [];
  const refused = [];
  for (const n of ls.stdout.split('\n').filter((x) => x.startsWith('py-'))) {
    const m = JSON.parse(await read(`${NM}/${n}/package.json`));
    const req = m.slicc?.python?.requires || {};
    const bad = ['abi', 'platform'].filter((k) => req[k] !== undefined && req[k] !== want[k]);
    if (bad.length) refused.push({ name: n, version: m.version, requires: req });
    else loadable.push(n);
  }
  return { python, want, loadable, refused };
}

export async function assertRefused({ run, assert }, split, tag) {
  if (!split.refused.length) return [];
  const mods = split.refused.map((p) => MODULES[p.name]).filter(Boolean);
  const code = `import importlib.util as u, json; print(json.dumps({m: u.find_spec(m) is None for m in ${JSON.stringify(mods)}}))`;
  const v = await run(['python', '-v', '-c', code], { cwd: '/home', env: {} });
  assert.equal(v.status, 0, `${tag}: python -v -c find_spec: rc=${v.status} ${v.stderr.slice(-2000)}`);
  const gone = JSON.parse(v.stdout.trim().split('\n').pop());
  const notes = v.stderr.split('\n').filter((l) => l.startsWith('slicc discover: skip'));
  for (const p of split.refused) {
    const m = MODULES[p.name];
    if (m) assert.equal(gone[m], true, `${tag}: ${p.name} ${p.version} (requires ${JSON.stringify(p.requires)}) is importable on ${split.want.abi}`);
    assert.ok(
      notes.some((l) => l.includes(`@ai-ecoverse/${p.name} ${p.version}: requires`) && l.includes(`this python is ${split.want.abi}/${split.want.platform}`)),
      `${tag}: python -v does not name ${p.name} ${p.version} as refused for its requires: ${notes.join(' | ')}`,
    );
  }
  const first = split.refused.find((p) => MODULES[p.name]);
  if (first) {
    const r = await run(['python', '-c', `import ${MODULES[first.name]}`], { cwd: '/home', env: {} });
    assert.equal(r.status, 1, `${tag}: import ${MODULES[first.name]} on ${split.want.abi}: rc=${r.status} (want 1, no trap) ${r.stderr.slice(-1000)}`);
    assert.match(r.stderr, new RegExp(`ModuleNotFoundError: No module named '${MODULES[first.name]}'`), `${tag}: ${r.stderr.slice(-1000)}`);
  }
  console.log(`${tag}: refused on ${split.want.abi} (requires another abi): ${split.refused.map((p) => `${p.name} ${p.version} (${p.requires.abi})`).join(', ')}`);
  return split.refused.map((p) => p.name);
}
