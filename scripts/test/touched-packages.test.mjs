import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');

function fixture(recipes) {
  const root = mkdtempSync(join(tmpdir(), 'homescoop-touched-'));
  mkdirSync(join(root, 'scripts'));
  for (const f of ['list-touched-packages.mjs', 'classify-touched-packages.mjs', 'read-recipe.mjs']) {
    copyFileSync(join(scripts, f), join(root, 'scripts', f));
  }
  for (const [name, { recipe, files = {} }] of Object.entries(recipes)) {
    mkdirSync(join(root, 'packages', name), { recursive: true });
    writeFileSync(join(root, 'packages', name, 'recipe.yaml'), recipe);
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, 'packages', name, f)), { recursive: true });
      writeFileSync(join(root, 'packages', name, f), body);
    }
  }
  const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });
  const touched = (paths, ...flags) =>
    spawnSync(process.execPath, [join(root, 'scripts/list-touched-packages.mjs'), '--stdin', '--json', ...flags], {
      cwd: root,
      encoding: 'utf8',
      input: paths.join('\n'),
    });
  const classify = (paths) => {
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'base');
    for (const p of paths) {
      mkdirSync(dirname(join(root, p)), { recursive: true });
      writeFileSync(join(root, p), `${Math.random()}\n`);
    }
    git('add', '-A');
    git('commit', '-qm', 'head');
    return spawnSync(process.execPath, [join(root, 'scripts/classify-touched-packages.mjs'), '--base', 'HEAD~1', '--head', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    });
  };
  return { root, touched, classify, done: () => rmSync(root, { recursive: true, force: true }) };
}

const recipes = {
  impeccable: {
    recipe: 'name: impeccable\nbuilder: host\ninputs:\n  - crates/wasix-net/**\n  - scripts/build-common.sh\n  - scripts/*.patch\n',
  },
  plugin: { recipe: 'name: plugin\nbuilder: host\ninputs:\n  - scripts/build-wasip1-go-command.sh\n' },
  gone: { recipe: 'name: gone\nbuilder: retired\ninputs:\n  - crates/**\n' },
  zlib: { recipe: 'name: zlib\nbuilder: host\n' },
};

test('inputs globs add a recipe to the matrix', () => {
  const f = fixture(recipes);
  try {
    const cases = [
      [['crates/wasix-net/src/lib.rs'], ['impeccable']],
      [['crates/wasix-net/Cargo.toml', 'packages/zlib/build.sh'], ['impeccable', 'zlib']],
      [['scripts/build-common.sh'], ['impeccable']],
      [['scripts/build-wasip1-go-command.sh'], ['plugin']],
      [['scripts/x.patch'], ['impeccable']],
      [['scripts/sub/x.patch'], []],
      [['scripts/build-common.sh.bak'], []],
      [['crates/wasix-netx/src/lib.rs'], []],
      [['crates/wasix-ureq/src/lib.rs'], []],
      [['docs/ladder-builds.md'], []],
    ];
    for (const [paths, want] of cases) {
      const r = f.touched(paths);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), want, paths.join(' '));
    }
  } finally {
    f.done();
  }
});

test('--publishable ignores inputs: only recipe.yaml or package/ publish', () => {
  const f = fixture(recipes);
  try {
    const r = f.touched(['crates/wasix-net/src/lib.rs', 'scripts/build-common.sh', 'packages/zlib/recipe.yaml'], '--publishable');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), ['zlib']);
  } finally {
    f.done();
  }
});

test('a retired recipe stays out, inputs or not', () => {
  const f = fixture(recipes);
  try {
    const r = f.touched(['crates/anything/x.rs', 'packages/gone/recipe.yaml']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), []);
  } finally {
    f.done();
  }
});

test('inputs that are not a list fail the detect job', () => {
  const f = fixture({ bad: { recipe: 'name: bad\nbuilder: host\ninputs: crates/**\n' } });
  try {
    const r = f.touched(['crates/x']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /inputs must be a list of path globs/);
  } finally {
    f.done();
  }
});

test('classify: rebuild for reproducible recipes, test for recipes with tests by layout', () => {
  const f = fixture({
    whole: { recipe: 'name: whole\nbuilder: host\nreproducible: true\n', files: { 'test/a.test.mjs': '' } },
    wasm: { recipe: 'name: wasm\nbuilder: host\nreproducible:\n  path: package/bin/x.wasm\n', files: { 'test/package.json': '{}' } },
    off: { recipe: 'name: off\nbuilder: host\nreproducible: false\n', files: { 'test/helper.mjs': '' } },
    cone: { recipe: 'name: cone\nbuilder: slicc\nreproducible: true\n', files: { 'test/a.test.mjs': '' } },
  });
  try {
    const r = f.classify(['packages/whole/build.sh', 'packages/wasm/build.sh', 'packages/off/build.sh', 'packages/cone/build.jsh']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      all: ['cone', 'off', 'wasm', 'whole'],
      host: ['off', 'wasm', 'whole'],
      slicc: ['cone'],
      rebuild: ['wasm', 'whole'],
      test: ['wasm', 'whole'],
    });
  } finally {
    f.done();
  }
});

test('classify: a reproducible value that is not true, false or a package/ path fails', () => {
  for (const bad of ['reproducible: yes\n', 'reproducible:\n  path: bin/x.wasm\n']) {
    const f = fixture({ r: { recipe: `name: r\nbuilder: host\n${bad}` } });
    try {
      const r = f.classify(['packages/r/build.sh']);
      assert.equal(r.status, 1, bad);
      assert.match(r.stderr, /reproducible must be/);
    } finally {
      f.done();
    }
  }
});
