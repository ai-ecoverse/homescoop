// refresh-recipe-sha.mjs re-pins a commit-pinned source that follows a tag
// (source.tag, e.g. v{{version}}) when Renovate bumps only version: (wasi-yq
// #2061, #2088): url, commit and tree move to the commit the new tag names,
// and the sha256 refresh that follows checks the archive against that tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', RECIPE_SHA_BASE: '' };
const git = (cwd, ...a) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd, encoding: 'utf8', env }).trim();

/** An upstream repo with v1.0 (lightweight) and v1.1 (annotated), each commit's archive served as up-<commit>.tar.gz. */
function upstream(root) {
  const dir = join(root, 'up');
  const served = join(root, 'served');
  mkdirSync(dir, { recursive: true });
  mkdirSync(served);
  git(dir, 'init', '-q');
  const release = (v, annotated) => {
    writeFileSync(join(dir, 'version.txt'), `${v}\n`);
    git(dir, 'add', '--', 'version.txt');
    git(dir, 'commit', '-qm', `release ${v}`);
    git(dir, 'tag', ...(annotated ? ['-a', '-m', v] : []), `v${v}`);
    const commit = git(dir, 'rev-parse', 'HEAD');
    const tar = execFileSync('git', ['archive', '--format=tar', `--prefix=up-${commit}/`, 'HEAD'], { cwd: dir, env });
    const file = join(served, `up-${commit}.tar.gz`);
    writeFileSync(file, execFileSync('gzip', ['-n', '-9'], { input: tar }));
    return { commit, tree: git(dir, 'rev-parse', 'HEAD^{tree}'), sha: sha(readFileSync(file)) };
  };
  return { dir, served, v10: release('1.0', false), v11: release('1.1', true) };
}

const recipe = ({ up, version, pin, extra = [] }) =>
  [
    'name: fx',
    'builder: host',
    `version: "${version}"`,
    'source:',
    `  url: "file://${up.served}/up-${pin.commit}.tar.gz"`,
    `  sha256: "${pin.sha}"`,
    '  tag: "v{{version}}"',
    `  git: "file://${up.dir}"`,
    `  commit: "${pin.commit}"`,
    `  tree: "${pin.tree}"`,
    ...extra,
    'about:',
    '  notes: |',
    `    fx ${version} (commit ${pin.commit.slice(0, 7)}).`,
    '',
  ].join('\n');

/** A homescoop-like repo: base on main, head on branch pr (with package/README.md). */
function repo({ baseRecipe, headRecipe, readme }) {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-sha-tag-'));
  mkdirSync(join(dir, 'scripts'));
  for (const f of ['refresh-recipe-sha.mjs', 'read-recipe.mjs', 'source-tree.mjs']) copyFileSync(join(scripts, f), join(dir, 'scripts', f));
  mkdirSync(join(dir, 'packages/fx/package'), { recursive: true });
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'packages/fx/recipe.yaml'), baseRecipe);
  const files = ['scripts/refresh-recipe-sha.mjs', 'scripts/read-recipe.mjs', 'scripts/source-tree.mjs', 'packages/fx/recipe.yaml'];
  if (readme) {
    writeFileSync(join(dir, 'packages/fx/package/README.md'), readme);
    files.push('packages/fx/package/README.md');
  }
  git(dir, 'add', '--', ...files);
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'pr');
  writeFileSync(join(dir, 'packages/fx/recipe.yaml'), headRecipe);
  git(dir, 'add', '--', 'packages/fx/recipe.yaml');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'head');
  const run = (...extra) =>
    spawnSync(process.execPath, [join(dir, 'scripts/refresh-recipe-sha.mjs'), 'fx', '--base', 'main', ...extra], { encoding: 'utf8', cwd: dir, env });
  const read = (f = 'recipe.yaml') => readFileSync(join(dir, 'packages/fx', f), 'utf8');
  return { dir, run, read };
}

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'recipe-sha-tag-up-'));
  let f;
  try {
    const up = upstream(root);
    fn(up, (o) => (f = repo(o)));
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (f) rmSync(f.dir, { recursive: true, force: true });
  }
}

test('a version-only bump re-pins url, commit and tree to the new tag, then refreshes the sha256 against that tree', () =>
  fixture((up, mk) => {
    const readme = `fx \`1.0\` (commit \`${up.v10.commit.slice(0, 7)}\`).\n`;
    const base = recipe({ up, version: '1.0', pin: up.v10 });
    const f = mk({ baseRecipe: base, headRecipe: base.replace('version: "1.0"', 'version: "1.1"'), readme });
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`recipe-sha: REPIN fx v1.1 ${up.v10.commit}→${up.v11.commit}`), r.stdout);
    assert.match(r.stdout, new RegExp(`source-tree: PASS archive matches tree ${up.v11.tree}`));
    assert.match(r.stdout, /recipe-sha: PASS 1 recipe/);
    const text = f.read();
    assert.ok(text.includes(`url: "file://${up.served}/up-${up.v11.commit}.tar.gz"`), text);
    assert.ok(text.includes(`commit: "${up.v11.commit}"`), text);
    assert.ok(text.includes(`tree: "${up.v11.tree}"`), text);
    assert.ok(text.includes(`sha256: "${up.v11.sha}"`), text);
    assert.ok(!text.includes(up.v10.commit) && !text.includes(up.v10.tree), text);
    // about.notes keeps its text (its version is stale too); package/README.md gets the short commit.
    assert.ok(text.includes(`(commit ${up.v10.commit.slice(0, 7)})`), text);
    assert.equal(f.read('package/README.md'), `fx \`1.0\` (commit \`${up.v11.commit.slice(0, 7)}\`).\n`);
    // A second run finds the pin is the tag's.
    const again = f.run('--verify-tree');
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.match(again.stdout, new RegExp(`tag v1\\.1: ${up.v11.commit} \\(pinned\\)`));
    assert.match(again.stdout, /sha256 unchanged/);
  }));

test('a pin that is already the tag\'s commit is left alone', () =>
  fixture((up, mk) => {
    const text = recipe({ up, version: '1.0', pin: up.v10 });
    const f = mk({ baseRecipe: text, headRecipe: text });
    const r = f.run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`tag v1\\.0: ${up.v10.commit} \\(pinned\\)`));
    assert.doesNotMatch(r.stdout, /REPIN/);
    assert.equal(f.read(), text);
  }));

test('a tag that moved upstream (same tag, another commit than the base pinned) fails and writes nothing', () =>
  fixture((up, mk) => {
    git(up.dir, 'tag', '-f', 'v1.0', up.v11.commit);
    const text = recipe({ up, version: '1.0', pin: up.v10 });
    const f = mk({ baseRecipe: text, headRecipe: text });
    const r = f.run();
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /recipe-sha: FAIL fx: source\.tag v1\.0 of .* names [0-9a-f]{40}, the recipe pins [0-9a-f]{40}, but main pins [0-9a-f]{40} for the same tag, so the tag moved upstream/);
    assert.equal(f.read(), text);
  }));

test('a commit the branch set itself is not re-pinned', () =>
  fixture((up, mk) => {
    const base = recipe({ up, version: '1.0', pin: up.v10 });
    const head = recipe({ up, version: '1.1', pin: { ...up.v10, commit: 'f'.repeat(40) } });
    const f = mk({ baseRecipe: base, headRecipe: head });
    const r = f.run();
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /recipe-sha: FAIL fx: .*this branch set that commit/);
    assert.equal(f.read(), head);
  }));

test('--check reports a stale pin and writes nothing', () =>
  fixture((up, mk) => {
    const base = recipe({ up, version: '1.0', pin: up.v10 });
    const head = base.replace('version: "1.0"', 'version: "1.1"');
    const f = mk({ baseRecipe: base, headRecipe: head, readme: `commit \`${up.v10.commit.slice(0, 7)}\`\n` });
    const r = f.run('--check');
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /recipe-sha: FAIL fx: source\.tag v1\.1 of .* names [0-9a-f]{40}, the recipe pins [0-9a-f]{40}\. Re-pin it/);
    assert.equal(f.read(), head);
    assert.equal(f.read('package/README.md'), `commit \`${up.v10.commit.slice(0, 7)}\`\n`);
  }));

test('a tag upstream does not have fails', () =>
  fixture((up, mk) => {
    const base = recipe({ up, version: '1.0', pin: up.v10 });
    const head = base.replace('version: "1.0"', 'version: "1.2"');
    const f = mk({ baseRecipe: base, headRecipe: head });
    const r = f.run();
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /recipe-sha: FAIL fx: source\.tag v1\.2 is not a tag of file:/);
    assert.equal(f.read(), head);
  }));

test('every recipe with source.tag pins a commit its url names', () => {
  const pkgs = join(scripts, '..', 'packages');
  const tagged = execFileSync('git', ['grep', '-l', '^  tag: ', '--', 'packages/*/recipe.yaml'], { cwd: join(scripts, '..'), encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
  assert.ok(tagged.length >= 1, tagged.join(', '));
  for (const rel of tagged) {
    const text = readFileSync(join(pkgs, '..', rel), 'utf8');
    const commit = /^ {2}commit: "([0-9a-f]{40})"$/m.exec(text)?.[1];
    assert.ok(commit, `${rel}: source.tag needs source.commit`);
    assert.match(text, new RegExp(`^ {2}url: ".*${commit}.*"$`, 'm'), `${rel}: source.url must name source.commit`);
    assert.match(text, /^ {2}tag: ".*\{\{version\}\}.*"$/m, `${rel}: source.tag must follow {{version}}`);
  }
});
