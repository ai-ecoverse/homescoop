import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  PYTHON,
  PYTHON_SERIES_PENDING,
  SERIES_LAST,
  inPythonRange,
  pinErrors,
  pythonRange,
  pythonSeries,
  rangeAllowed,
  seriesRange,
  seriesState,
} from '../check-exact-pins.mjs';
import { fakePython, lockErrors, lockFor, seriesProbes } from '../browser-cert/python-range.mjs';
import { satisfies } from '../cert-kernel-floor.mjs';

const PUBLISHED = JSON.parse(readFileSync(new URL('./fixtures/python-series/py-numpy-2.5.4-4.package.json', import.meta.url), 'utf8'));
const SERIES = pythonSeries('3.15.0-1');

const versions = () => {
  const out = [];
  for (const [x, y] of [[3, 14], [3, 15], [3, 16]]) {
    for (let z = 0; z <= SERIES_LAST + 2; z++) for (const n of [0, 1, 2, 10]) out.push(`${x}.${y}.${z}-${n}`);
  }
  return out;
};

test('pythonSeries: the floor line, then every later X.Y.Z-N line through X.Y.29', () => {
  assert.equal(SERIES_LAST, 29);
  const lines = SERIES.split(' || ');
  assert.equal(lines.length, 30);
  assert.equal(lines[0], '>=3.15.0-1 <3.15.1');
  assert.equal(lines[1], '>=3.15.1-1 <3.15.2');
  assert.equal(lines[2], '>=3.15.2-1 <3.15.3');
  assert.equal(lines.at(-1), '>=3.15.29-1 <3.15.30');
  assert.equal(pythonSeries('3.15.0-8').split(' || ')[0], '>=3.15.0-8 <3.15.1');
  assert.equal(pythonSeries('3.15.2-1').split(' || ').length, 28);
  for (const bad of ['3.15.0', '3.15.0-post0.1', '>=3.15.0-1', '3.15.29-1', '3.15.0-01', null]) assert.equal(pythonSeries(bad), null, String(bad));
});

test('seriesRange: only the canonical string', () => {
  assert.deepEqual(
    { ...seriesRange(SERIES), lines: undefined },
    { floor: '3.15.0-1', last: '3.15.29', below: '3.15.30', lines: undefined },
  );
  const lines = SERIES.split(' || ');
  const bad = [
    '>=3.15.0-1 <3.15.1',
    '>=3.15.0-1 <3.16.0',
    lines.slice(0, -1).join(' || '),
    [...lines, '>=3.15.30-1 <3.15.31'].join(' || '),
    lines.filter((_, i) => i !== 3).join(' || '),
    lines.map((l, i) => (i === 2 ? '>=3.15.2-0 <3.15.3' : l)).join(' || '),
    lines.join('||'),
    `${SERIES} `,
    [...lines.slice(0, 2), '>=3.16.0-1 <3.16.1', ...lines.slice(3)].join(' || '),
    `>=3.15.0-1 <3.15.1 || ${lines.slice(1).join(' || ')} || 3.16.0-1`,
  ];
  for (const b of bad) assert.equal(seriesRange(b), null, b.slice(0, 60));
});

test('inPythonRange on the series agrees with npm semver (cert-kernel-floor.satisfies) on every probed version', () => {
  for (const v of versions()) assert.equal(inPythonRange(v, SERIES), satisfies(v, SERIES), v);
  for (const v of ['3.15.0-1', '3.15.0-10', '3.15.1-1', '3.15.2-1', '3.15.2-7', '3.15.29-1']) assert.equal(inPythonRange(v, SERIES), true, v);
  for (const v of ['3.15.0-0', '3.15.2-0', '3.15.30-1', '3.16.0-1', '3.14.10-1']) assert.equal(inPythonRange(v, SERIES), false, v);
});

test('a minor-wide range would not take 3.15.2-1: npm semver drops prereleases of another x.y.z', () => {
  for (const r of ['>=3.15.0-1 <3.16.0', '>=3.15.0-1 <3.16.0-0']) {
    assert.equal(satisfies('3.15.0-10', r), true, r);
    assert.equal(satisfies('3.15.2-1', r), false, r);
  }
  assert.equal(satisfies('3.15.2-1', SERIES), true);
});

test('rangeAllowed: the series only for wasix-python, only in py-* and wasm-emscripten dependencies', () => {
  const py = { name: '@ai-ecoverse/py-newpkg' };
  assert.equal(rangeAllowed(py, 'dependencies', PYTHON, SERIES), true);
  assert.equal(rangeAllowed({ name: '@ai-ecoverse/wasm-emscripten' }, 'dependencies', PYTHON, SERIES), true);
  assert.equal(rangeAllowed(py, 'peerDependencies', PYTHON, SERIES), false);
  assert.equal(rangeAllowed(py, 'optionalDependencies', PYTHON, SERIES), false);
  assert.equal(rangeAllowed(py, 'dependencies', '@ai-ecoverse/py-numpy', pythonSeries('2.5.4-1')), false);
  assert.equal(rangeAllowed({ name: '@ai-ecoverse/wasm-git' }, 'dependencies', PYTHON, SERIES), false);
  assert.equal(rangeAllowed({ name: '@ai-ecoverse/aws-cli' }, 'dependencies', PYTHON, SERIES), false);
  assert.equal(rangeAllowed(py, 'dependencies', '@ai-ecoverse/py-numpy', '>=2.5.4-1 <2.5.5'), true);
});

test('pinErrors: a py-* outside PYTHON_SERIES_PENDING may not take wasix-python as a patch range', () => {
  const pkg = (name, spec) => ({ name, version: '1.0.0-1', dependencies: { [PYTHON]: spec } });
  assert.deepEqual(pinErrors(pkg('@ai-ecoverse/py-newpkg', SERIES)), []);
  assert.equal(pinErrors(pkg('@ai-ecoverse/py-newpkg', '>=3.15.0-1 <3.15.1')).length, 1);
  assert.deepEqual(pinErrors(pkg('@ai-ecoverse/py-numpy', '>=3.15.0-1 <3.15.1')), []);
  assert.deepEqual(pinErrors(pkg('@ai-ecoverse/py-numpy', SERIES)), []);
  assert.equal(pinErrors(pkg('@ai-ecoverse/py-newpkg', '>=3.15.0-1 <3.16.0')).length, 1);
});

test('seriesState: pending while on the patch range, repinned after it', () => {
  assert.equal(seriesState({ name: '@ai-ecoverse/py-numpy', dependencies: { [PYTHON]: '>=3.15.0-1 <3.15.1' } }), 'pending');
  assert.equal(seriesState({ name: '@ai-ecoverse/py-numpy', dependencies: { [PYTHON]: SERIES } }), 'repinned');
  assert.equal(seriesState({ name: '@ai-ecoverse/py-newpkg', dependencies: { [PYTHON]: SERIES } }), null);
  assert.equal(PYTHON_SERIES_PENDING.size, 16);
  for (const name of PYTHON_SERIES_PENDING) {
    const dir = name === '@ai-ecoverse/wasm-emscripten' ? 'wasm-emscripten' : name.slice('@ai-ecoverse/'.length);
    const pj = JSON.parse(readFileSync(new URL(`../../packages/${dir}/package/package.json`, import.meta.url), 'utf8'));
    assert.equal(pj.name, name);
  }
});

test('seriesProbes: the next patch line and the last one', () => {
  assert.deepEqual(seriesProbes(SERIES), ['3.15.1-1', '3.15.29-1']);
  assert.deepEqual(seriesProbes(pythonSeries('3.15.2-1')), ['3.15.3-1', '3.15.29-1']);
  assert.deepEqual(seriesProbes('>=3.15.0-1 <3.15.1'), []);
});

const CLI = new URL('../check-exact-pins.mjs', import.meta.url).pathname;

test('check-exact-pins CLI: a listed py-* that already takes the series range passes with a notice; a patch range is pending; a wider range fails', () => {
  const work = mkdtempSync(join(tmpdir(), 'python-series-cli-'));
  try {
    const run = (spec) => {
      const file = join(work, `${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(file, JSON.stringify({ ...PUBLISHED, version: '2.5.4-5', dependencies: { ...PUBLISHED.dependencies, [PYTHON]: spec } }));
      return spawnSync(process.execPath, [CLI, '--file', file], { encoding: 'utf8' });
    };
    const repinned = run(SERIES);
    assert.equal(repinned.status, 0, repinned.stderr);
    assert.match(repinned.stdout, /notice .*py-numpy@2\.5\.4-5\): re-pinned to the series range/);
    assert.match(repinned.stdout, /check-exact-pins: PASS 1 package\.json/);
    const pending = run('>=3.15.0-1 <3.15.1');
    assert.equal(pending.status, 0, pending.stderr);
    assert.match(pending.stdout, /pending .*until its re-pin to pythonSeries\('3\.15\.0-1'\)/);
    const wide = run('>=3.15.0-1 <3.16.0');
    assert.equal(wide.status, 1);
    assert.match(wide.stderr, /check-exact-pins: FAIL/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

function pyTarball(work, manifest) {
  const dir = mkdtempSync(join(work, 'py-'));
  mkdirSync(join(dir, 'package'));
  writeFileSync(join(dir, 'package', 'package.json'), JSON.stringify(manifest));
  const tgz = join(dir, 'py.tgz');
  const r = spawnSync('tar', ['czf', tgz, '-C', dir, 'package']);
  assert.equal(r.status, 0, String(r.stderr));
  return tgz;
}

test('npm: published py-numpy 2.5.4-4 beside wasix-python 3.15.2-1 needs a second python; its series re-pin resolves one', () => {
  const work = mkdtempSync(join(tmpdir(), 'python-series-'));
  const offline = ['--offline', '--cache', join(work, 'cache'), '--loglevel', 'error'];
  try {
    const spec = PUBLISHED.dependencies[PYTHON];
    assert.equal(PUBLISHED.name, '@ai-ecoverse/py-numpy');
    assert.equal(PUBLISHED.version, '2.5.4-4');
    assert.equal(spec, '>=3.15.0-1 <3.15.1');
    assert.equal(seriesRange(spec), null);
    assert.equal(inPythonRange('3.15.2-1', spec), false);
    assert.throws(
      () => lockFor(pyTarball(work, PUBLISHED), fakePython('3.15.2-1', work), work, [], offline),
      /ENOTCACHED/,
    );
    const repinned = { ...PUBLISHED, version: '2.5.4-5', dependencies: { ...PUBLISHED.dependencies, [PYTHON]: pythonSeries(pythonRange(spec).floor) } };
    const tgz = pyTarball(work, repinned);
    for (const python of ['3.15.2-1', ...seriesProbes(repinned.dependencies[PYTHON])]) {
      assert.deepEqual(lockErrors(lockFor(tgz, fakePython(python, work), work, [], offline), python), [], python);
    }
    assert.throws(() => lockFor(tgz, fakePython('3.16.0-1', work), work, [], offline), /ENOTCACHED/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
