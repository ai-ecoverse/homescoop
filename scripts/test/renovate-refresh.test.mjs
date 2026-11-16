// scripts/renovate-refresh.mjs: which Renovate PRs get the mechanical refresh,
// and the refresh itself against a local origin (no network, no gh).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { AUTHOR, MARKER, handComment, packagesOf, recipeSha, refresh, reportedFor, skipReason, strayPaths } from '../renovate-refresh.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
const RENOVATE = { email: '29139614+renovate[bot]@users.noreply.github.com', login: 'renovate[bot]' };
const git = (cwd, ...a) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd, encoding: 'utf8', env }).trim();

const pr = (over = {}) => ({
  number: 7,
  author: { login: 'app/renovate' },
  isDraft: false,
  isCrossRepository: false,
  headRefName: 'renovate/fx-1.x',
  headRefOid: 'a'.repeat(40),
  files: [{ path: 'packages/fx/recipe.yaml' }],
  commits: [{ authors: [RENOVATE] }],
  statusCheckRollup: [{ name: 'detect', status: 'COMPLETED', conclusion: 'SUCCESS' }, { name: 'recipe-sha', status: 'COMPLETED', conclusion: 'FAILURE' }],
  comments: [],
  ...over,
});

test('a Renovate recipe PR whose recipe-sha failed on its own head is refreshed', () => {
  assert.equal(skipReason(pr()), null);
});

test('anything else is left alone, with the reason', () => {
  const cases = [
    [{ author: { login: 'lars' } }, /not a Renovate PR/],
    [{ isDraft: true }, /draft/],
    [{ isCrossRepository: true }, /fork/],
    [{ headRefName: 'bb/thing' }, /renovate\/ branch/],
    [{ files: [{ path: 'packages/fx/recipe.yaml' }, { path: 'packages/fx/build.sh' }] }, /hand work/],
    [{ files: [{ path: 'package.json' }] }, /hand work/],
    [{ commits: [{ authors: [RENOVATE] }, { authors: [{ email: 'renovate-refresh@homescoop.invalid' }] }] }, /not by Renovate/],
    [{ statusCheckRollup: [{ name: 'recipe-sha', status: 'IN_PROGRESS', conclusion: null }] }, /PENDING/],
    [{ statusCheckRollup: [{ name: 'recipe-sha', status: 'COMPLETED', conclusion: 'SUCCESS' }] }, /SUCCESS/],
    [{ statusCheckRollup: [] }, /missing/],
    [{ comments: [{ body: `${MARKER}\n**renovate-refresh: needs a hand** on head ${'a'.repeat(40)}` }] }, /already reported/],
  ];
  for (const [over, why] of cases) assert.match(skipReason(pr(over)) ?? 'null', why, JSON.stringify(over));
});

test('a needs-hand comment for an older head does not block a new one', () => {
  assert.ok(!reportedFor([{ body: handComment('b'.repeat(40), 'x') }], 'a'.repeat(40)));
  assert.ok(reportedFor([{ body: handComment('a'.repeat(40), 'x', 'log') }], 'a'.repeat(40)));
});

test('packagesOf, strayPaths and recipeSha', () => {
  assert.deepEqual(packagesOf(['packages/b/recipe.yaml', 'packages/a/recipe.yaml']), ['a', 'b']);
  assert.equal(packagesOf([]), null);
  assert.deepEqual(strayPaths(['README.md', 'packages/a/recipe.yaml', 'packages/a/package/package.json', 'packages/a/package/README.md', 'packages/a/build.sh', 'packages/b/recipe.yaml'], ['a']), ['packages/a/build.sh', 'packages/b/recipe.yaml']);
  assert.equal(recipeSha([{ name: 'recipe-sha', status: 'COMPLETED', conclusion: 'FAILURE' }]), 'FAILURE');
});

/** origin (bare) with main carrying packages/fx 1.2.0 and a later commit, and renovate/fx-1.x bumping version: to `bump`. */
function fixture(bump) {
  const dir = mkdtempSync(join(tmpdir(), 'renovate-refresh-'));
  for (const v of ['1.2.0', '1.3.0']) {
    mkdirSync(join(dir, 'src', `fx-${v}`), { recursive: true });
    writeFileSync(join(dir, 'src', `fx-${v}`, 'f.txt'), `fx ${v}\n`);
    execFileSync('tar', ['-czf', join(dir, `fx-${v}.tar.gz`), '-C', join(dir, 'src'), `fx-${v}`]);
  }
  const sha = (v) => createHash('sha256').update(readFileSync(join(dir, `fx-${v}.tar.gz`))).digest('hex');
  const seed = join(dir, 'seed');
  mkdirSync(join(seed, 'scripts'), { recursive: true });
  for (const f of readdirSync(scripts)) if (statSync(join(scripts, f)).isFile()) copyFileSync(join(scripts, f), join(seed, 'scripts', f));
  mkdirSync(join(seed, 'packages/fx/package'), { recursive: true });
  const recipe = (v) =>
    ['name: fx', 'builder: host', `version: "${v}"`, 'npm: "@x/fx"', 'summary: "fx 1.2.0 for tests"', 'source:', `  url: "file://${dir}/fx-{{version}}.tar.gz"`, `  sha256: "${sha('1.2.0')}"`, ''].join('\n');
  writeFileSync(join(seed, 'packages/fx/recipe.yaml'), recipe('1.2.0'));
  writeFileSync(join(seed, 'packages/fx/package/package.json'), `${JSON.stringify({ name: '@x/fx', version: '1.2.0-1', description: 'fx.', license: 'MIT', homescoop: { recipe: 'fx', upstream: '1.2.0' } }, null, 2)}\n`);
  writeFileSync(join(seed, 'packages/fx/package/README.md'), '# fx\n\nfx 1.2.0, for tests.\n');
  writeFileSync(join(seed, 'README.md'), '# r\n\n<!-- packages:start (generated by scripts/readme-table.mjs --write; do not edit) -->\n<!-- packages:end -->\n');
  git(seed, 'init', '-q');
  execFileSync(process.execPath, ['scripts/readme-table.mjs', '--write'], { cwd: seed, stdio: 'ignore' });
  git(seed, 'add', '--', 'scripts', 'packages', 'README.md');
  git(seed, 'commit', '-qm', 'base');
  git(seed, 'checkout', '-qb', 'renovate/fx-1.x');
  writeFileSync(join(seed, 'packages/fx/recipe.yaml'), recipe(bump));
  git(seed, 'add', '--', 'packages/fx/recipe.yaml');
  execFileSync('git', ['-c', 'user.name=renovate[bot]', '-c', `user.email=${RENOVATE.email}`, 'commit', '-qm', `chore(deps): update fx to v${bump}`], { cwd: seed, env });
  git(seed, 'checkout', '-q', 'main');
  writeFileSync(join(seed, 'NOTES.md'), 'later on main\n');
  git(seed, 'add', '--', 'NOTES.md');
  git(seed, 'commit', '-qm', 'later');
  const origin = join(dir, 'origin.git');
  git(dir, 'clone', '-q', '--bare', seed, origin);
  const clone = join(dir, 'clone');
  git(dir, 'clone', '-q', origin, clone);
  const head = git(origin, 'rev-parse', 'renovate/fx-1.x');
  return { dir, origin, clone, head, sha, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('refresh rebases onto main, writes sha256, version and README, and pushes one commit as renovate-refresh', () => {
  const f = fixture('1.3.0');
  try {
    const r = refresh(f.clone, pr({ headRefOid: f.head }), { dryRun: false });
    assert.equal(r.pushed, true, JSON.stringify(r));
    const tip = git(f.origin, 'rev-parse', 'renovate/fx-1.x');
    assert.equal(tip, r.sha);
    assert.equal(git(f.origin, 'log', '-1', '--format=%an <%ae>', tip), `${AUTHOR.name} <${AUTHOR.email}>`);
    assert.equal(git(f.origin, 'merge-base', '--is-ancestor', 'main', tip), '');
    assert.equal(git(f.origin, 'rev-list', '--count', `main..${tip}`), '2');
    assert.deepEqual(git(f.origin, 'diff', '--name-only', `${tip}~1`, tip).split('\n').sort(), ['packages/fx/package/README.md', 'packages/fx/package/package.json', 'packages/fx/recipe.yaml']);
    const show = (p) => git(f.origin, 'show', `${tip}:${p}`);
    assert.ok(show('packages/fx/recipe.yaml').includes(`sha256: "${f.sha('1.3.0')}"`));
    assert.ok(show('packages/fx/recipe.yaml').includes('summary: "fx 1.3.0 for tests"'));
    assert.equal(JSON.parse(show('packages/fx/package/package.json')).version, '1.3.0-1');
    assert.match(show('packages/fx/package/README.md'), /fx 1\.3\.0, for tests/);
    assert.equal(git(f.clone, 'worktree', 'list').split('\n').length, 1, 'worktree left behind');
  } finally {
    f.cleanup();
  }
});

test('a refresh that fails pushes nothing and says why', () => {
  const f = fixture('1.4.0');
  try {
    const r = refresh(f.clone, pr({ headRefOid: f.head }), { dryRun: false });
    assert.equal(r.pushed, undefined);
    assert.match(r.hand, /refresh-recipe-sha\.mjs fx failed/);
    assert.match(r.log, /fx-1\.4\.0\.tar\.gz/);
    assert.equal(git(f.origin, 'rev-parse', 'renovate/fx-1.x'), f.head);
  } finally {
    f.cleanup();
  }
});

test('a head that moved since the PR was read is skipped', () => {
  const f = fixture('1.3.0');
  try {
    const r = refresh(f.clone, pr({ headRefOid: 'c'.repeat(40) }), { dryRun: false });
    assert.match(r.error, /the head moved/);
    assert.equal(git(f.origin, 'rev-parse', 'renovate/fx-1.x'), f.head);
  } finally {
    f.cleanup();
  }
});
