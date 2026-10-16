// #568: homescoop_compile_pyc must not embed the build directory in .pyc
// (co_filename), so py-* packages built in different checkouts are identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = 'lib/python3.14/site-packages';

function hasPython() {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function build(base, env = {}) {
  const site = join(base, 'packages', 'py-demo', 'package', SITE);
  mkdirSync(join(site, 'demo'), { recursive: true });
  writeFileSync(join(site, 'demo', '__init__.py'), 'def f():\n    raise ValueError("x")\n');
  execFileSync('bash', ['-c', 'source "$HOMESCOOP_ROOT/scripts/build-common.sh"; homescoop_compile_pyc "$1"', 'x', site], {
    env: { ...process.env, HOMESCOOP_ROOT: ROOT, HOMESCOOP_WORK: join(base, 'work'), PREFIX: join(base, 'prefix'), WASIX_PYTHON_HOST_PY: 'python3', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const cache = join(site, 'demo', '__pycache__');
  const [pyc] = readdirSync(cache).filter((f) => f.endsWith('.pyc'));
  return readFileSync(join(cache, pyc));
}

test('pyc bytes do not depend on the build directory', { skip: !hasPython() && 'no python3' }, () => {
  const a = mkdtempSync(join(tmpdir(), 'pyc-a-'));
  const b = mkdtempSync(join(tmpdir(), 'pyc-bb-other-'));
  try {
    const pa = build(a);
    const pb = build(b);
    assert.ok(!pa.includes(Buffer.from(a)), 'pyc embeds the build directory');
    assert.ok(pa.includes(Buffer.from(`/node_modules/@ai-ecoverse/py-demo/${SITE}/demo/__init__.py`)), 'pyc names the runtime path');
    assert.deepEqual(pa, pb);
  } finally {
    rmSync(a, { recursive: true, force: true });
    rmSync(b, { recursive: true, force: true });
  }
});

test('a dir outside <pkg>/package/ needs HOMESCOOP_PYC_DDIR', { skip: !hasPython() && 'no python3' }, () => {
  const a = mkdtempSync(join(tmpdir(), 'pyc-c-'));
  try {
    const site = join(a, 'loose');
    mkdirSync(site, { recursive: true });
    writeFileSync(join(site, 'm.py'), 'x = 1\n');
    const run = (env) =>
      execFileSync('bash', ['-c', 'source "$HOMESCOOP_ROOT/scripts/build-common.sh"; homescoop_compile_pyc "$1"', 'x', site], {
        env: { ...process.env, HOMESCOOP_ROOT: ROOT, HOMESCOOP_WORK: join(a, 'work'), PREFIX: join(a, 'prefix'), WASIX_PYTHON_HOST_PY: 'python3', ...env },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    assert.throws(() => run({}));
    // The override names one tree's runtime path, so two dirs are refused.
    assert.throws(() =>
      execFileSync('bash', ['-c', 'source "$HOMESCOOP_ROOT/scripts/build-common.sh"; homescoop_compile_pyc "$1" "$1"', 'x', site], {
        env: { ...process.env, HOMESCOOP_ROOT: ROOT, HOMESCOOP_WORK: join(a, 'work'), PREFIX: join(a, 'prefix'), WASIX_PYTHON_HOST_PY: 'python3', HOMESCOOP_PYC_DDIR: '/fixed' },
        stdio: ['ignore', 'ignore', 'pipe'],
      }),
    );
    run({ HOMESCOOP_PYC_DDIR: '/fixed' });
    const [pyc] = readdirSync(join(site, '__pycache__'));
    assert.ok(readFileSync(join(site, '__pycache__', pyc)).includes(Buffer.from('/fixed/m.py')));
  } finally {
    rmSync(a, { recursive: true, force: true });
  }
});
