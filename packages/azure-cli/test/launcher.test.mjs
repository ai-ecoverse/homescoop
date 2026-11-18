// src/launcher.py's own_packages() on host python3, against node_modules
// trees made here: which py-* site-packages bin/az puts on sys.path, and why
// it refuses the others (the reason its ERROR line gives). The cert specs
// (cert/launcher.mjs, cert/native.mjs) run the same rule in slicc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const launcher = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'launcher.py');
const PY = { abi: 'cp315', platform: 'wasix_wasm32' };
const PYRANGE = '>=3.15.0-8 <3.15.1';
const AZ_DEPS = {
  '@ai-ecoverse/py-cffi': '2.1.1-2',
  '@ai-ecoverse/py-cryptography': '50.0.2-1',
  '@ai-ecoverse/py-pycparser': '3.12.0-1',
  '@ai-ecoverse/wasix-python': '3.15.0-10',
};

function pkg(dir, manifest) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
}

// A flat npm tree: python, az and the py-* packages side by side.
function tree({ cffi = '2.1.1-2', cryptoRequires = PY, python = '3.15.0-10', nestedCffi = null, skip = [] } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'az-launcher-')));
  const nm = join(root, 'node_modules', '@ai-ecoverse');
  pkg(join(nm, 'wasix-python'), { name: '@ai-ecoverse/wasix-python', version: python, slicc: { python: { ...PY, sitePackages: 'lib/python3.15/site-packages' } } });
  pkg(join(nm, 'azure-cli'), { name: '@ai-ecoverse/azure-cli', version: '2.93.0-2', dependencies: AZ_DEPS });
  const py = (name, version, deps, requires) => ({
    name: `@ai-ecoverse/${name}`, version, dependencies: deps,
    slicc: { python: { sitePackages: requires ? 'lib/python3.15/site-packages' : 'lib/python3/site-packages', ...(requires ? { requires } : {}) } },
  });
  if (!skip.includes('py-pycparser')) pkg(join(nm, 'py-pycparser'), py('py-pycparser', '3.12.0-1', {}, null));
  if (!skip.includes('py-cffi')) pkg(join(nm, 'py-cffi'), py('py-cffi', cffi, { '@ai-ecoverse/py-pycparser': '>=3.12.0-1 <3.12.1', '@ai-ecoverse/wasix-python': PYRANGE }, PY));
  pkg(join(nm, 'py-cryptography'), py('py-cryptography', '50.0.2-1', { '@ai-ecoverse/wasix-python': PYRANGE, '@ai-ecoverse/py-cffi': '>=2.1.1-1 <2.1.2' }, cryptoRequires));
  if (nestedCffi) {
    pkg(join(nm, 'py-cryptography', 'node_modules', '@ai-ecoverse', 'py-cffi'), py('py-cffi', nestedCffi, { '@ai-ecoverse/wasix-python': PYRANGE }, PY));
  }
  return { root, nm };
}

function own(az, python) {
  const r = spawnSync('python3', ['-S', '-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("azlauncher", ${JSON.stringify(launcher)})
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
m.PACKAGE = ${JSON.stringify(az)}
sys.base_prefix = ${JSON.stringify(python)}
print(json.dumps({"dirs": m.own_packages(), "refused": m.REFUSED}))
`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('a flat npm tree: every pinned py-* package, in package.json order', (t) => {
  const { root, nm } = tree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const got = own(join(nm, 'azure-cli'), join(nm, 'wasix-python'));
  assert.deepEqual(got.refused, {});
  assert.deepEqual(got.dirs, [
    join(nm, 'py-cffi', 'lib/python3.15/site-packages'),
    join(nm, 'py-cryptography', 'lib/python3.15/site-packages'),
    join(nm, 'py-pycparser', 'lib/python3/site-packages'),
  ]);
});

test('pnpm: az and its dependencies linked from the store', (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'az-launcher-pnpm-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = join(root, 'node_modules', '.pnpm');
  const entry = (name, version) => join(store, `@ai-ecoverse+${name}@${version}`, 'node_modules', '@ai-ecoverse', name);
  const py = (name, version, deps, requires) => pkg(entry(name, version), {
    name: `@ai-ecoverse/${name}`, version, dependencies: deps,
    slicc: { python: { sitePackages: 'lib/site', ...(requires ? { requires: PY } : {}) } },
  });
  pkg(entry('wasix-python', '3.15.0-10'), { name: '@ai-ecoverse/wasix-python', version: '3.15.0-10', slicc: { python: { ...PY } } });
  pkg(entry('azure-cli', '2.93.0-2'), { name: '@ai-ecoverse/azure-cli', version: '2.93.0-2', dependencies: AZ_DEPS });
  py('py-pycparser', '3.12.0-1', {}, false);
  py('py-cffi', '2.1.1-2', { '@ai-ecoverse/py-pycparser': '>=3.12.0-1 <3.12.1', '@ai-ecoverse/wasix-python': PYRANGE }, true);
  py('py-cryptography', '50.0.2-1', { '@ai-ecoverse/py-cffi': '>=2.1.1-1 <2.1.2', '@ai-ecoverse/wasix-python': PYRANGE }, true);
  // Each entry's node_modules links its dependencies, as pnpm does.
  const link = (from, fromVersion, to, toVersion) => {
    const at = join(store, `@ai-ecoverse+${from}@${fromVersion}`, 'node_modules', '@ai-ecoverse', to);
    symlinkSync(entry(to, toVersion), at);
  };
  for (const [n, v] of Object.entries(AZ_DEPS)) link('azure-cli', '2.93.0-2', n.split('/')[1], v);
  link('py-cffi', '2.1.1-2', 'py-pycparser', '3.12.0-1');
  link('py-cffi', '2.1.1-2', 'wasix-python', '3.15.0-10');
  link('py-cryptography', '50.0.2-1', 'py-cffi', '2.1.1-2');
  link('py-cryptography', '50.0.2-1', 'wasix-python', '3.15.0-10');
  const got = own(entry('azure-cli', '2.93.0-2'), entry('wasix-python', '3.15.0-10'));
  assert.deepEqual(got.refused, {});
  assert.deepEqual(got.dirs, ['py-cffi@2.1.1-2', 'py-cryptography@50.0.2-1', 'py-pycparser@3.12.0-1'].map((e) => {
    const [n, v] = e.split('@');
    return join(entry(n, v), 'lib/site');
  }));
});

test('another version, a missing package, another ABI, another python: refused, with the reason', async (t) => {
  const cases = [
    [{ cffi: '2.1.1-3' }, '@ai-ecoverse/py-cffi', / is @ai-ecoverse\/py-cffi 2\.1\.1-3, az needs @ai-ecoverse\/py-cffi 2\.1\.1-2$/],
    [{ skip: ['py-cffi'] }, '@ai-ecoverse/py-cffi', /^it isn't installed beside az \(az needs 2\.1\.1-2\)$/],
    [{ cryptoRequires: { abi: 'cp314', platform: 'wasix_wasm32' } }, '@ai-ecoverse/py-cryptography', /is built for cp314\/wasix_wasm32, this python is cp315\/wasix_wasm32$/],
    [{ python: '3.15.1-1' }, '@ai-ecoverse/py-cffi', /is for wasix-python 3\.15\.0-10, this python is 3\.15\.1-1$/],
  ];
  for (const [opts, refused, why] of cases) {
    const { root, nm } = tree(opts);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    // A python of another version than az's: a second copy beside it.
    let python = join(nm, 'wasix-python');
    if (opts.python) {
      python = join(root, 'other-python');
      pkg(python, { name: '@ai-ecoverse/wasix-python', version: opts.python, slicc: { python: { ...PY } } });
      pkg(join(nm, 'wasix-python'), { name: '@ai-ecoverse/wasix-python', version: '3.15.0-10', slicc: { python: { ...PY } } });
    }
    const got = own(join(nm, 'azure-cli'), python);
    assert.match(got.refused[refused] || '', why, `${JSON.stringify(opts)}: ${JSON.stringify(got.refused)}`);
    assert.ok(!got.dirs.some((d) => d.includes(refused.split('/')[1])), JSON.stringify(got.dirs));
    // py-cryptography needs py-cffi: without az's, it goes too.
    if (opts.cffi || opts.skip) {
      assert.match(got.refused['@ai-ecoverse/py-cryptography'], /^it needs @ai-ecoverse\/py-cffi, which az couldn't use: /);
    }
  }
});

test("a py-* package's own dependency must be the copy az takes", (t) => {
  const { root, nm } = tree({ nestedCffi: '2.1.1-9' });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const got = own(join(nm, 'azure-cli'), join(nm, 'wasix-python'));
  assert.match(got.refused['@ai-ecoverse/py-cryptography'], /^its @ai-ecoverse\/py-cffi is .*py-cryptography\/node_modules\/@ai-ecoverse\/py-cffi, not az's .*\/py-cffi$/);
  assert.deepEqual(got.dirs.map((d) => d.split('@ai-ecoverse/')[1].split('/')[0]), ['py-cffi', 'py-pycparser']);
});

test('a python that is not wasix-python takes none', (t) => {
  const { root, nm } = tree();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const got = own(join(nm, 'azure-cli'), root);
  assert.deepEqual(got.dirs, []);
  assert.match(got.refused['@ai-ecoverse/py-cryptography'], /isn't @ai-ecoverse\/wasix-python$/);
});
