// #735: a repack must not reuse bytes whose build inputs changed since they
// were built. Fixture: a git repo with one recipe, built at 1.0-1, then
// repacked; scripts/repack-inputs.mjs must refuse a changed build.sh, patch
// or source pin and accept README / package / cert-only changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'a'.repeat(64);

function recipe({ repack, url = 'https://example.org/fx-{{version}}.tar.gz', sha = SHA, extra = '' } = {}) {
  return [
    'name: fx',
    'builder: host',
    'version: "1.0"',
    'npm: "@ai-ecoverse/fx"',
    'summary: "fixture"',
    'source:',
    `  url: "${url}"`,
    `  sha256: "${sha}"`,
    ...(repack ? ['repack:', `  from: "${repack}"`, ...extra.split('\n').filter(Boolean)] : []),
    'dependencies:',
    '  build: []',
    '  host: []',
    '  run: []',
    '',
  ].join('\n');
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'repack-inputs-test-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@example.org');
  g('config', 'user.name', 't');
  mkdirSync(join(dir, 'scripts'));
  for (const f of ['repack-inputs.mjs', 'read-recipe.mjs']) copyFileSync(join(scripts, f), join(dir, 'scripts', f));
  const put = (p, text) => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  };
  const version = (v) => put('packages/fx/package/package.json', `${JSON.stringify({ name: '@ai-ecoverse/fx', version: v })}\n`);
  const commit = (m) => {
    g('add', '-A');
    g('commit', '-q', '-m', m);
  };
  // 1.0-1: a real build.
  put('packages/fx/recipe.yaml', recipe());
  put('packages/fx/build.sh', '#!/bin/sh\nmake\n');
  put('packages/fx/patches/0001-fix.patch', 'old\n');
  put('packages/fx/hints/wasix', 'a=1\n');
  put('packages/fx/package/README.md', 'v1\n');
  version('1.0-1');
  commit('fx 1.0-1');
  // 1.0-2: packaging-only repack of 1.0-1.
  put('packages/fx/recipe.yaml', recipe({ repack: '1.0-1' }));
  put('packages/fx/package/README.md', 'v2\n');
  version('1.0-2');
  commit('fx 1.0-2 repack');
  // The PR under test: 1.0-3, repack of 1.0-2.
  put('packages/fx/recipe.yaml', recipe({ repack: '1.0-2' }));
  version('1.0-3');
  const run = () => spawnSync(process.execPath, [join(dir, 'scripts/repack-inputs.mjs'), 'fx'], { encoding: 'utf8' });
  return { dir, put, run, g };
}

function withRepo(fn) {
  const r = repo();
  try {
    fn(r);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
}

test('README, package/, cert/ and run-dependency changes repack; the chain resolves to the built version', () =>
  withRepo(({ put, run }) => {
    put('packages/fx/package/README.md', 'v3\n');
    put('packages/fx/cert/meta.json', '{}\n');
    put('packages/fx/NEGATIVE.md', 'x\n');
    put('packages/fx/recipe.yaml', recipe({ repack: '1.0-2' }).replace('  run: []', '  run:\n    - other'));
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no build input changed since 1\.0-1/);
  }));

test('a changed build.sh, patch or hints file refuses the repack, naming the root and the file', () => {
  for (const f of ['build.sh', 'patches/0001-fix.patch', 'hints/wasix']) {
    withRepo(({ put, run }) => {
      put(`packages/fx/${f}`, 'changed\n');
      const r = run();
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stderr, new RegExp(`build inputs changed since 1\\.0-1 .*chain 1\\.0-2 ← 1\\.0-1`));
      assert.ok(r.stderr.includes(`packages/fx/${f} (blob `), r.stderr);
      assert.match(r.stderr, /drop repack: and rebuild/);
    });
  }
});

test('a new input file and a changed source pin refuse; a mirror move with the same sha256 does not', () => {
  withRepo(({ put, run }) => {
    put('packages/fx/wasix-stubs.h', '#define X\n');
    assert.equal(run().status, 1);
  });
  withRepo(({ put, run }) => {
    put('packages/fx/recipe.yaml', recipe({ repack: '1.0-2', sha: 'b'.repeat(64) }));
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /recipe\.yaml \(build fields/);
  });
  withRepo(({ put, run }) => {
    put('packages/fx/recipe.yaml', recipe({ repack: '1.0-2', url: 'https://mirror.example.org/fx-{{version}}.tar.gz' }));
    assert.equal(run().status, 0);
  });
});

test('repack.patches and repack.files sources are not build inputs', () =>
  withRepo(({ put, run }) => {
    put('packages/fx/glue.patch', '--- a/package/x\n+++ b/package/x\n');
    put('packages/fx/drivers/cc.sh', 'cc\n');
    put('packages/fx/recipe.yaml', recipe({ repack: '1.0-2', extra: '  patches:\n    - glue.patch\n  files:\n    - bin/cc=drivers/cc.sh' }));
    const r = run();
    assert.equal(r.status, 0, r.stderr);
  }));

test('repack.inputs_changed lets it through and says so', () =>
  withRepo(({ put, run }) => {
    put('packages/fx/build.sh', '#!/bin/sh\nmake # comment\n');
    put('packages/fx/recipe.yaml', recipe({ repack: '1.0-2', extra: '  inputs_changed: "comment only"' }));
    const r = run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /allowed by repack\.inputs_changed: comment only/);
  }));

test('the allowlist pins a file to its blob: that blob passes, a later edit fails, a bad line fails', () =>
  withRepo(({ dir, put, run, g }) => {
    put('packages/fx/build.sh', 'v2\n');
    const blob = g('hash-object', 'packages/fx/build.sh').trim();
    put('scripts/repack-inputs-allowlist.txt', `# c\nfx build.sh ${blob} #735 fixture\n`);
    assert.equal(run().status, 0, run().stderr);
    put('packages/fx/build.sh', 'v3\n');
    assert.equal(run().status, 1);
    put('scripts/repack-inputs-allowlist.txt', 'fx build.sh nothex #735 x\n');
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /want "<package> <path>/);
    assert.ok(readFileSync(join(dir, 'packages/fx/build.sh'), 'utf8') === 'v3\n');
  }));

test('a repack.from no commit ever had is refused', () =>
  withRepo(({ put, run }) => {
    put('packages/fx/recipe.yaml', recipe({ repack: '0.9-1' }));
    const r = run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no commit has packages\/fx\/package\/package\.json at 0\.9-1/);
  }));

test('every allowlist line names a package, a path, a pin, an issue and a reason', () => {
  const lines = readFileSync(join(scripts, 'repack-inputs-allowlist.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  for (const l of lines) assert.match(l, /^\S+ \S+ ([0-9a-f]{40}|[0-9a-f]{64}|deleted) #\d+ \S/, l);
});
