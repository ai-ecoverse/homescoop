import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function stepRun(file, name) {
  const lines = readFileSync(join(root, '.github', 'workflows', file), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, name);
  const start = lines.findIndex((l, i) => i > at && l.trim() === 'run: |');
  const indent = lines[start + 1].match(/^ */)[0];
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && !l.startsWith(indent)) break;
    body.push(l.slice(indent.length));
  }
  return body.join('\n');
}

const STEP = stepRun('ladder-pr.yml', 'Download expanded source URLs and write sha256');

function runWith(refresh) {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-sha-step-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(join(root, 'scripts', 'gate.mjs'), join(dir, 'scripts', 'gate.mjs'));
    writeFileSync(join(dir, 'scripts', 'refresh-recipe-sha.mjs'), refresh);
    return spawnSync('bash', ['-c', STEP], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOST: '["pkg"]' } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a pre-#1019 head (no verdict line in its refresh-recipe-sha.mjs) runs unwrapped, passes, and warns to merge main', () => {
  const r = runWith("console.log('refreshed', process.argv[2]);\n");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /refreshed pkg/);
  assert.match(r.stdout, /::warning::recipe-sha: this branch's refresh-recipe-sha\.mjs predates the verdict line/);
});

test('NEGATIVE: a head whose script has the verdict line is wrapped, so a silent exit 0 still fails with exit 3', () => {
  const r = runWith("// prints 'recipe-sha: PASS' in the real script; this one stays silent\nprocess.exit(0);\n");
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /::warning::recipe-sha/);
});

test('a head whose script prints its verdict passes through the wrapper, with no warning', () => {
  const r = runWith("console.log('recipe-sha: PASS 1 recipe');\n");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /recipe-sha: PASS 1 recipe/);
  assert.doesNotMatch(r.stdout, /::warning::recipe-sha/);
});

test('a pre-#1267 head, whose script takes every non-flag argument as a package, still gets only the package (the base goes in RECIPE_SHA_BASE)', () => {
  const r = runWith(
    "const names = process.argv.slice(2).filter((a) => !a.startsWith('-'));\n" +
      "if (names.join() !== 'pkg') { console.log('recipe-sha: FAIL ' + names.join()); process.exit(1); }\n" +
      "console.log('recipe-sha: PASS 1 recipe');\n"
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /recipe-sha: PASS 1 recipe/);
});

const PUSH = stepRun(
  'ladder-pr.yml',
  'The PR branch already carries its sha256 and package version, or the check fails with the command that writes them'
);

function pushStep(dirty, readme = false) {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-sha-push-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  try {
    for (const pkg of ['pkg', 'other']) {
      mkdirSync(join(dir, 'packages', pkg, 'package'), { recursive: true });
      writeFileSync(join(dir, 'packages', pkg, 'recipe.yaml'), 'version: 1\n');
    }
    writeFileSync(join(dir, 'README.md'), 'table\n');
    git('init', '-q');
    git('add', '--', 'packages/pkg/recipe.yaml', 'packages/other/recipe.yaml', 'README.md');
    git('-c', 'user.name=t', '-c', 'user.email=t@invalid', 'commit', '-qm', 'base');
    if (dirty) writeFileSync(join(dir, 'packages', 'pkg', 'recipe.yaml'), 'version: 1\nsha256: abc\n');
    if (readme) writeFileSync(join(dir, 'README.md'), 'table v2\n');
    const out = join(dir, 'out');
    const r = spawnSync('bash', ['-c', PUSH], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, HOST: '["pkg","other"]', GITHUB_OUTPUT: out },
    });
    return { ...r, outputs: readFileSync(out, 'utf8'), log: git('log', '--oneline').stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('recipe-sha never pushes: a stale branch fails with one machine-readable refresh line per stale package', () => {
  const r = pushStep(true);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(
    r.stdout,
    /^recipe-sha: FAIL pkg: needs refresh: node scripts\/refresh-recipe-sha\.mjs pkg && node scripts\/sync-package-version\.mjs pkg --write && node scripts\/readme-table\.mjs --write$/m
  );
  assert.doesNotMatch(r.stdout, /recipe-sha: FAIL other:/);
  assert.equal(r.log.trim().split('\n').length, 1, 'no commit was made');
  assert.match(r.outputs, /^changed=false$/m);
  assert.doesNotMatch(r.outputs, /^sha=/m);
});

test('recipe-sha passes a branch that already carries its sha256, with its verdict line', () => {
  const r = pushStep(false);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^recipe-sha: PASS /m);
});

test('the recipe-sha job holds a read-only token and no persisted credentials, and runs no git push', () => {
  const yml = readFileSync(join(root, '.github', 'workflows', 'ladder-pr.yml'), 'utf8');
  const job = yml.slice(yml.indexOf('\n  recipe-sha:'), yml.indexOf('\n  host-build:'));
  assert.match(job, /\n {4}permissions:\n {6}contents: read\n/);
  assert.match(job, /\n {10}persist-credentials: false\n/);
  assert.doesNotMatch(job, /git push|contents: write/);
  assert.match(job, /\n {10}ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}\n/);
  assert.doesNotMatch(job, /github\.head_ref/);
});

test('with two packages, one stale and the README table rewritten, only the stale package gets a FAIL line', () => {
  const r = pushStep(true, true);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const lines = r.stdout.split('\n').filter((l) => l.startsWith('recipe-sha: FAIL'));
  assert.deepEqual(lines, [
    'recipe-sha: FAIL pkg: needs refresh: node scripts/refresh-recipe-sha.mjs pkg && node scripts/sync-package-version.mjs pkg --write && node scripts/readme-table.mjs --write',
  ]);
});

test('a README table that alone is stale gets its own FAIL line and no package line', () => {
  const r = pushStep(false, true);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const lines = r.stdout.split('\n').filter((l) => l.startsWith('recipe-sha: FAIL'));
  assert.deepEqual(lines, ['recipe-sha: FAIL README.md: needs refresh: node scripts/readme-table.mjs --write']);
});

