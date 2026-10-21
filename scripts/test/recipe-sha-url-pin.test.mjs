// refresh-recipe-sha.mjs rewrites a source pin only when the source URL changed
// against the base, and a GitHub-archive re-roll needs a matching source.tree and
// an explicit --reroll (#1267).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { githubArchive } from '../source-tree.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', RECIPE_SHA_BASE: '' };
const git = (cwd, ...a) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd, encoding: 'utf8', env }).trim();

/** An upstream repo; returns { dir, commit, tree, archive(level, out) }. */
function upstream(dir, files) {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q');
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  git(dir, 'add', '-A', '-f');
  git(dir, 'commit', '-qm', 'up');
  const commit = git(dir, 'rev-parse', 'HEAD');
  const tree = git(dir, 'rev-parse', 'HEAD^{tree}');
  const archive = (level, out, zip = false) => {
    if (zip) {
      writeFileSync(out, execFileSync('git', ['archive', '--format=zip', `-${level}`, `--prefix=up-${commit}/`, 'HEAD'], { cwd: dir, env, maxBuffer: 1 << 26 }));
      return;
    }
    const tar = execFileSync('git', ['archive', '--format=tar', `--prefix=up-${commit}/`, 'HEAD'], { cwd: dir, env, maxBuffer: 1 << 26 });
    writeFileSync(out, execFileSync('gzip', ['-n', `-${level}`], { input: tar }));
  };
  return { dir, commit, tree, archive };
}

/** A homescoop-like repo with packages/fx on main (base) and HEAD on branch pr. */
function repo({ baseRecipe, headRecipe }) {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-sha-url-'));
  mkdirSync(join(dir, 'scripts'));
  for (const f of ['refresh-recipe-sha.mjs', 'read-recipe.mjs', 'source-tree.mjs']) copyFileSync(join(scripts, f), join(dir, 'scripts', f));
  mkdirSync(join(dir, 'packages/fx'), { recursive: true });
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'packages/fx/recipe.yaml'), baseRecipe);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'pr');
  writeFileSync(join(dir, 'packages/fx/recipe.yaml'), headRecipe);
  git(dir, 'commit', '-q', '--allow-empty', '-am', 'head');
  const run = (...extra) =>
    spawnSync(process.execPath, [join(dir, 'scripts/refresh-recipe-sha.mjs'), 'fx', '--base', 'main', ...extra], { encoding: 'utf8', cwd: dir, env });
  const read = () => readFileSync(join(dir, 'packages/fx/recipe.yaml'), 'utf8');
  return { dir, run, read };
}

const recipe = ({ version = '1.0', url, pin, extra = [] }) =>
  ['name: fx', 'builder: host', `version: "${version}"`, 'source:', `  url: "${url}"`, `  sha256: "${pin}"`, ...extra, ''].join('\n');

test('an unchanged URL with changed bytes fails and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-sha-src-'));
  try {
    const src = join(dir, 'src-1.0.tar.gz');
    writeFileSync(src, 'new bytes\n');
    const pinned = 'a'.repeat(64);
    const text = recipe({ url: `file://${dir}/src-{{version}}.tar.gz`, pin: pinned });
    const f = repo({ baseRecipe: text, headRecipe: text });
    try {
      const r = f.run();
      assert.notEqual(r.status, 0, r.stdout);
      assert.ok(
        r.stdout.includes(`recipe-sha: FAIL fx: file://${dir}/src-1.0.tar.gz changed bytes for an unchanged URL (pinned ${pinned}, got ${sha('new bytes\n')})`),
        r.stdout
      );
      assert.equal(f.read(), text);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a changed URL (a version bump) refreshes the sha', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-sha-src-'));
  try {
    writeFileSync(join(dir, 'src-1.1.tar.gz'), 'v1.1\n');
    const url = `file://${dir}/src-{{version}}.tar.gz`;
    const f = repo({ baseRecipe: recipe({ url, pin: 'a'.repeat(64) }), headRecipe: recipe({ version: '1.1', url, pin: 'a'.repeat(64) }) });
    try {
      const r = f.run();
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /url changed against main/);
      assert.match(f.read(), new RegExp(`sha256: "${sha('v1.1\n')}"`));
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a base the script cannot resolve fails closed on a mismatch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-sha-src-'));
  try {
    writeFileSync(join(dir, 'src-1.0.tar.gz'), 'x\n');
    const text = recipe({ url: `file://${dir}/src-{{version}}.tar.gz`, pin: 'a'.repeat(64) });
    const f = repo({ baseRecipe: text, headRecipe: text });
    try {
      const r = spawnSync(process.execPath, [join(f.dir, 'scripts/refresh-recipe-sha.mjs'), 'fx', '--base', 'no-such-ref'], { encoding: 'utf8', cwd: f.dir, env });
      assert.notEqual(r.status, 0);
      assert.match(r.stdout, /recipe-sha: FAIL fx: .*can't resolve the base no-such-ref/);
      assert.equal(f.read(), text);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A re-rolled archive of one upstream commit, pinned by source.tree. */
const ATTRS = { 'README': 'hello\n', 'src/a.c': 'int a;\n', 'crlf.txt': 'one\ntwo\n', 'ver.txt': 'describe: $Format:%H$\n', 'skip.txt': 'left out\n', 'ign.txt': 'committed but ignored\n', '.gitignore': 'ign.txt\n', '.gitattributes': 'crlf.txt text eol=crlf\nver.txt export-subst\nskip.txt export-ignore\n' };
const SUBST = { 'README': 'hello\n', 'src/a.c': 'int a;\n', 'ver.txt': 'describe: $Format:%H$\n', '.gitattributes': 'ver.txt export-subst\n' };
const PLAIN = { 'README': 'hello\n', 'src/a.c': 'int a;\n', 'crlf.txt': 'one\ntwo\n', 'ign.txt': 'committed but ignored\n', '.gitignore': 'ign.txt\n', '.gitattributes': 'crlf.txt text eol=crlf\n' };

function rerollFixture({ different = false, tamper = 'src/a.c', content = 'int a = 1;\n', zip = false, files = ATTRS, tree = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-sha-tree-'));
  const up = upstream(join(dir, 'up'), files);
  const served = join(dir, zip ? 'archive' : 'archive.tar.gz');
  up.archive(zip ? 0 : 1, served, zip);
  const oldSha = sha(readFileSync(served));
  if (different) {
    writeFileSync(join(up.dir, tamper), content);
    git(up.dir, 'commit', '-qam', 'tamper');
    up.archive(9, served, zip);
    git(up.dir, 'reset', '-q', '--hard', up.commit);
  } else {
    up.archive(9, served, zip);
  }
  const newSha = sha(readFileSync(served));
  assert.notEqual(oldSha, newSha);
  const text = recipe({ url: `file://${served}`, pin: oldSha, extra: [`  git: "file://${up.dir}"`, `  commit: "${up.commit}"`, ...(tree ? [`  tree: "${up.tree}"`] : [])] });
  const f = repo({ baseRecipe: text, headRecipe: text });
  return { ...f, text, oldSha, newSha, tree: up.tree, cleanup: () => { rmSync(f.dir, { recursive: true, force: true }); rmSync(dir, { recursive: true, force: true }); } };
}

test('a re-rolled archive whose tree matches needs --reroll, then refreshes with the tree check in the log', () => {
  const f = rerollFixture();
  try {
    const r = f.run();
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /changed bytes for an unchanged URL .* Its tree matches source\.tree .*--reroll/);
    assert.equal(f.read(), f.text);
    const ok = f.run('--reroll');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, new RegExp(`source-tree: PASS archive matches tree ${f.tree} \\(export-subst ver\\.txt; export-ignore 1\\)`));
    assert.match(ok.stdout, /re-roll: the archive matches source\.tree/);
    assert.ok(ok.stdout.includes(`recipe-sha: REROLL fx ${f.oldSha}→${f.newSha} sha256 tree=${f.tree}`), ok.stdout);
    assert.match(f.read(), new RegExp(`sha256: "${f.newSha}"`));
  } finally {
    f.cleanup();
  }
});

test('a shallow checkout with no origin/main (ladder-pr build jobs) compares a re-roll against the base tip, not "can\'t resolve the base"', () => {
  const f = rerollFixture();
  const clone = mkdtempSync(join(tmpdir(), 'recipe-sha-shallow-'));
  try {
    git(clone, 'clone', '-q', '--depth=1', '--branch', 'pr', `file://${f.dir}`, 'c');
    const cwd = join(clone, 'c');
    const run = (...extra) => spawnSync(process.execPath, [join(cwd, 'scripts/refresh-recipe-sha.mjs'), 'fx', ...extra], { encoding: 'utf8', cwd, env });
    const read = () => readFileSync(join(cwd, 'packages/fx/recipe.yaml'), 'utf8');
    const plain = run();
    assert.notEqual(plain.status, 0, plain.stdout);
    assert.doesNotMatch(plain.stdout + plain.stderr, /can't resolve the base/);
    assert.match(plain.stdout, /base: shallow checkout, comparing against the tip of main/);
    assert.match(plain.stdout, /recipe-sha: FAIL fx: .*changed bytes for an unchanged URL .* Its tree matches source\.tree .*--reroll/);
    assert.equal(read(), f.text);
    const ok = run('--reroll');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, new RegExp(`source-tree: PASS archive matches tree ${f.tree}`));
    assert.match(ok.stdout, /re-roll: the archive matches source\.tree/);
    assert.match(ok.stdout, /recipe-sha: PASS/);
    assert.match(read(), new RegExp(`sha256: "${f.newSha}"`));
  } finally {
    rmSync(clone, { recursive: true, force: true });
    f.cleanup();
  }
});

test('--ci-reroll (ladder-pr build jobs): a re-roll whose extracted tree hashes to source.tree passes with a REROLL verdict', () => {
  const f = rerollFixture({ files: PLAIN });
  try {
    const r = f.run('--ci-reroll');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`recipe-sha: REROLL fx ${f.oldSha}→${f.newSha} sha256 tree=${f.tree}`), r.stdout);
    assert.match(r.stdout, /recipe-sha: PASS 1 recipe/);
    assert.match(f.read(), new RegExp(`sha256: "${f.newSha}"`));
  } finally {
    f.cleanup();
  }
});

test('--ci-reroll: an export-subst file may differ only in its $Format$ placeholders (llvm-project .git_archival.txt), named in the REROLL line', () => {
  const f = rerollFixture({ files: SUBST });
  try {
    const r = f.run('--ci-reroll');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`recipe-sha: REROLL fx ${f.oldSha}→${f.newSha} sha256 tree=${f.tree} export-subst=ver.txt`), r.stdout);
  } finally {
    f.cleanup();
  }
  const g = rerollFixture({ files: SUBST, different: true, tamper: 'ver.txt', content: 'describe: $Format:%H$\nimport os; os.system("x")\n' });
  try {
    const r = g.run('--ci-reroll');
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /source-tree: FAIL .*differs from the tree: ver\.txt/);
    assert.equal(g.read(), g.text);
  } finally {
    g.cleanup();
  }
});

test('NEGATIVE --ci-reroll: a tree mismatch, an archive missing export-ignore paths, and a recipe without source.tree all fail and write nothing', () => {
  const cases = [
    [{ files: PLAIN, different: true }, /does not match the pinned source\.tree/],
    [{ files: ATTRS }, /: 1 export-ignore path\(s\) are missing, and --ci-reroll accepts only the whole tree/],
    [{ files: PLAIN, tree: false }, /changed bytes for an unchanged URL .*the upstream bytes moved under the pin/],
  ];
  for (const [opts, why] of cases) {
    const f = rerollFixture(opts);
    try {
      const r = f.run('--ci-reroll');
      assert.notEqual(r.status, 0, r.stdout);
      assert.match(r.stdout, why);
      assert.doesNotMatch(r.stdout, /recipe-sha: REROLL/);
      assert.equal(f.read(), f.text);
    } finally {
      f.cleanup();
    }
  }
});

test('a re-rolled archive with a different tree fails, even with --reroll', () => {
  const f = rerollFixture({ different: true });
  try {
    const r = f.run('--reroll');
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /source-tree: FAIL .*differs from the tree: src\/a\.c/);
    assert.match(r.stdout, /recipe-sha: FAIL fx: .*changed bytes for an unchanged URL.*does not match the pinned source\.tree/);
    assert.equal(f.read(), f.text);
  } finally {
    f.cleanup();
  }
});

test('an export-subst file may differ only in its $Format$ placeholders', () => {
  const f = rerollFixture({ different: true, tamper: 'ver.txt', content: 'describe: $Format:%H$\nimport os; os.system("x")\n' });
  try {
    const r = f.run('--reroll');
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /source-tree: FAIL .*differs from the tree: ver\.txt/);
    assert.equal(f.read(), f.text);
  } finally {
    f.cleanup();
  }
});

test('a zip archive with no extension (codeload zip) is checked by its magic bytes', () => {
  const f = rerollFixture({ zip: true });
  try {
    const ok = f.run('--reroll');
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /source-tree: PASS archive matches tree/);
  } finally {
    f.cleanup();
  }
});

test('a changed URL whose pin this branch already set is not rewritten when its bytes move', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-sha-src-'));
  try {
    writeFileSync(join(dir, 'src-1.1.tar.gz'), 'moved\n');
    const url = `file://${dir}/src-{{version}}.tar.gz`;
    const branchPin = 'b'.repeat(64);
    const head = recipe({ version: '1.1', url, pin: branchPin });
    const f = repo({ baseRecipe: recipe({ url, pin: 'a'.repeat(64) }), headRecipe: head });
    try {
      const r = f.run();
      assert.notEqual(r.status, 0, r.stdout);
      assert.match(r.stdout, new RegExp(`recipe-sha: FAIL fx: .*changed bytes under a pin this branch already set \\(pinned ${branchPin}`));
      assert.equal(f.read(), head);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--verify-tree checks a pinned tree when the sha matches', () => {
  const f = rerollFixture({ different: true });
  try {
    const text = f.text.replace(f.oldSha, f.newSha);
    writeFileSync(join(f.dir, 'packages/fx/recipe.yaml'), text);
    const plain = f.run();
    assert.equal(plain.status, 0, plain.stdout + plain.stderr);
    const r = f.run('--verify-tree');
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /recipe-sha: FAIL fx: .*does not match the pinned source\.tree/);
  } finally {
    f.cleanup();
  }
});

test('githubArchive reads repo and commit from archive and codeload URLs', () => {
  const c = 'b158b0ae6c559f87be325b8f427c5588e6a48823';
  assert.deepEqual(githubArchive(`https://github.com/llvm/llvm-project/archive/${c}.tar.gz`), { repo: 'https://github.com/llvm/llvm-project.git', commit: c });
  assert.deepEqual(githubArchive(`https://codeload.github.com/llvm/llvm-project/tar.gz/${c}`), { repo: 'https://github.com/llvm/llvm-project.git', commit: c });
  assert.deepEqual(githubArchive(`https://codeload.github.com/llvm/llvm-project/zip/${c}`), { repo: 'https://github.com/llvm/llvm-project.git', commit: c });
  assert.equal(githubArchive('https://github.com/wasix-org/wasix-libc/archive/refs/tags/v2026-07-03.1.tar.gz'), null);
});
