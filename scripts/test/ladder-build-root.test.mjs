// ladder-pr's rebuild builds in another directory, WORK and user name than
// host-build, so `reproducible` proves path independence (#668).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, realpathSync, lstatSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');

function fixture(recipe, wsRel = '_work/homescoop/homescoop') {
  const t = realpathSync(mkdtempSync(join(tmpdir(), 'homescoop-build-root-')));
  const ws = join(t, ...wsRel.split('/'));
  mkdirSync(join(ws, 'scripts'), { recursive: true });
  for (const f of ['ladder-build-root.sh', 'read-recipe.mjs']) copyFileSync(join(scripts, f), join(ws, 'scripts', f));
  mkdirSync(join(ws, 'packages', 'p'), { recursive: true });
  writeFileSync(join(ws, 'packages', 'p', 'recipe.yaml'), recipe);
  writeFileSync(join(ws, 'marker'), 'x');
  const base = join(t, 'work');
  const run = (mode, extra = {}) => {
    const r = spawnSync('bash', [join(ws, 'scripts', 'ladder-build-root.sh'), mode, 'p'], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_WORKSPACE: ws, REPO: 'homescoop', HOMESCOOP_HOSTED_BASE: base, TMPDIR: '/tmpx', ...extra },
    });
    const env = Object.fromEntries(r.stdout.trim().split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    return { ...r, env };
  };
  return { t, ws, base, run, done: () => rmSync(t, { recursive: true, force: true }) };
}

test('host: the hosted path, linked to the workspace, default WORK and user', () => {
  const f = fixture('name: p\nbuilder: host\nreproducible: true\n');
  try {
    const r = f.run('host');
    assert.equal(r.status, 0, r.stderr);
    const want = join(f.base, 'homescoop', 'homescoop');
    assert.deepEqual(r.env, { HOMESCOOP_BUILD_ROOT: want });
    assert.ok(lstatSync(want).isSymbolicLink());
    assert.equal(realpathSync(want), f.ws);
  } finally {
    f.done();
  }
});

test('rebuild: a real copy elsewhere, its own WORK and user name', () => {
  const f = fixture('name: p\nbuilder: host\nreproducible: true\n');
  try {
    writeFileSync(join(f.ws, 'later'), 'refreshed sha');
    const r = f.run('rebuild');
    assert.equal(r.status, 0, r.stderr);
    const want = join(f.base, 'homescoop-rebuild', 'homescoop');
    assert.deepEqual(r.env, {
      HOMESCOOP_BUILD_ROOT: want,
      HOMESCOOP_WORK: '/tmpx/homescoop-rebuild-work',
      USER: 'homescoop-rebuild',
      LOGNAME: 'homescoop-rebuild',
    });
    assert.ok(!lstatSync(want).isSymbolicLink());
    assert.equal(realpathSync(want), want);
    assert.notEqual(realpathSync(want), realpathSync(f.ws));
    assert.equal(readFileSync(join(want, 'later'), 'utf8'), 'refreshed sha');
    // A second run replaces a stale copy.
    writeFileSync(join(want, 'stale'), 'old');
    assert.equal(f.run('rebuild').status, 0);
    assert.ok(!existsSync(join(want, 'stale')));
  } finally {
    f.done();
  }
});

test('rebuild with reproducible.same_path: host-build paths, named in the log', () => {
  const f = fixture('name: p\nbuilder: host\nreproducible:\n  same_path: 668\n');
  try {
    const r = f.run('rebuild');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.env, { HOMESCOOP_BUILD_ROOT: join(f.base, 'homescoop', 'homescoop') });
    assert.match(r.stderr, /same_path \(#668\)/);
  } finally {
    f.done();
  }
});

test('host refuses a hosted path that is a real directory, not a link', () => {
  const f = fixture('name: p\nbuilder: host\nreproducible: true\n');
  try {
    mkdirSync(join(f.base, 'homescoop', 'homescoop'), { recursive: true });
    const r = f.run('host');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /exists and is not a link/);
  } finally {
    f.done();
  }
});

test('rebuild refuses to copy over the workspace itself', () => {
  const f = fixture('name: p\nbuilder: host\nreproducible: true\n', 'work/homescoop-rebuild/homescoop');
  try {
    const r = f.run('rebuild');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is the workspace/);
    assert.ok(existsSync(join(f.ws, 'marker')), 'workspace intact');
  } finally {
    f.done();
  }
});
