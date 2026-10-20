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

test('classify: rebuild for every built recipe unless it says reproducible: false (#808), test for tests by layout, pool for runner: pool and pure repacks', () => {
  const f = fixture({
    whole: { recipe: 'name: whole\nbuilder: host\nreproducible: true\n', files: { 'test/a.test.mjs': '' } },
    wasm: { recipe: 'name: wasm\nbuilder: host\nreproducible:\n  path: package/bin/x.wasm\n', files: { 'test/package.json': '{}' } },
    off: { recipe: 'name: off\nbuilder: host\nreproducible: false\nrunner: pool\n', files: { 'test/helper.mjs': '' } },
    cone: { recipe: 'name: cone\nbuilder: slicc\nreproducible: true\nrunner: pool\n', files: { 'test/a.test.mjs': '' } },
    repack: { recipe: 'name: repack\nbuilder: host\nrepack:\n  from: "1.0.0-1"\n' },
    smoked: { recipe: 'name: smoked\nbuilder: host\nrepack:\n  from: "1.0.0-1"\n', files: { 'smoke.c': 'int main(void) { return 0; }\n' } },
    tested: { recipe: 'name: tested\nbuilder: host\nrepack:\n  from: "1.0.0-1"\n', files: { 'test/package.json': '{}' } },
    built: { recipe: 'name: built\nbuilder: host\n' },
  });
  try {
    const r = f.classify(['packages/whole/build.sh', 'packages/wasm/build.sh', 'packages/off/build.sh', 'packages/cone/build.jsh', 'packages/repack/package/README.md', 'packages/smoked/package/README.md', 'packages/tested/package/README.md', 'packages/built/build.sh']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      all: ['built', 'cone', 'off', 'repack', 'smoked', 'tested', 'wasm', 'whole'],
      host: ['built', 'off', 'repack', 'smoked', 'tested', 'wasm', 'whole'],
      slicc: ['cone'],
      rebuild: ['built', 'wasm', 'whole'],
      test: ['tested', 'wasm', 'whole'],
      pool: ['off', 'repack'],
    });
  } finally {
    f.done();
  }
});

test('classify --all: every recipe but the retired ones, as if all were touched (pool-parity)', () => {
  const f = fixture({
    pooled: { recipe: 'name: pooled\nbuilder: host\nrunner: pool\n' },
    repack: { recipe: 'name: repack\nbuilder: host\nrepack:\n  from: "1.0.0-1"\n' },
    hosted: { recipe: 'name: hosted\nbuilder: host\n' },
    gone: { recipe: 'name: gone\nbuilder: retired\nrunner: pool\n' },
  });
  try {
    mkdirSync(join(f.root, 'packages', 'no-recipe'), { recursive: true });
    const r = spawnSync(process.execPath, [join(f.root, 'scripts/classify-touched-packages.mjs'), '--all'], { cwd: f.root, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), {
      all: ['hosted', 'pooled', 'repack'],
      host: ['hosted', 'pooled', 'repack'],
      slicc: [],
      rebuild: ['hosted', 'pooled'],
      test: [],
      pool: ['pooled', 'repack'],
    });
  } finally {
    f.done();
  }
});

test('classify: a reproducible value that is not true, false or a package/ path fails', () => {
  for (const bad of ['reproducible: yes\n', 'reproducible:\n  path: bin/x.wasm\n', 'reproducible:\n  same_path: soon\n', 'reproducible:\n  same: 1\n']) {
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

test('classify: a runner other than pool fails', () => {
  for (const bad of ['runner: hosted\n', 'runner: cloud-run-bench\n', 'runner: ubuntu-latest\n']) {
    const f = fixture({ r: { recipe: `name: r\nbuilder: host\n${bad}` } });
    try {
      const r = f.classify(['packages/r/build.sh']);
      assert.equal(r.status, 1, bad);
      assert.match(r.stderr, /runner must be pool/);
    } finally {
      f.done();
    }
  }
});

test('classify: reproducible.same_path (an issue number), alone or with path:, still rebuilds (#668)', () => {
  const f = fixture({
    same: { recipe: 'name: same\nbuilder: host\nreproducible:\n  same_path: 668\n' },
    both: { recipe: 'name: both\nbuilder: host\nreproducible:\n  path: package/bin/x.wasm\n  same_path: 668\n' },
  });
  try {
    const r = f.classify(['packages/same/build.sh', 'packages/both/build.sh']);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).rebuild, ['both', 'same']);
  } finally {
    f.done();
  }
});

test('toolchain default inputs: a shared toolchain file touches every built recipe whose build uses it (#857)', () => {
  const f = fixture({
    em: { recipe: 'name: em\nbuilder: host\n', files: { 'build.sh': 'source "$ROOT/scripts/build-common.sh"\nemconfigure ./configure\n' } },
    gnu: { recipe: 'name: gnu\nbuilder: host\n', files: { 'build.sh': 'source "$ROOT/scripts/build-common.sh"\nsource "$ROOT/scripts/build-gnu-cli.sh"\n' } },
    slicc: { recipe: 'name: slicc\nbuilder: host\n', files: { 'build.sh': 'LIBS="$(homescoop_slicc_archive "$WORK/s.a" gaps)"\n' } },
    cxx: { recipe: 'name: cxx\nbuilder: host\n', files: { 'build.sh': 'CXX=em++ make\n' } },
    opt: { recipe: 'name: opt\nbuilder: host\n', files: { 'build.sh': 'homescoop_wasm_opt "$OUT/x.wasm" x -Oz\n' } },
    wx: { recipe: 'name: wx\nbuilder: host\n', files: { 'build.sh': 'eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$WORK/wasixcc")"\n' } },
    go: { recipe: 'name: go\nbuilder: host\n', files: { 'build.sh': 'eval "$(bash "$ROOT/scripts/install-go.sh" go "$WORK/go")"\n' } },
    said: { recipe: 'name: said\nbuilder: host\n', files: { 'build.sh': '# binaryen, pinned as in scripts/install-wasixcc.sh; not emcc\ncargo build\n' } },
    said2: { recipe: 'name: said2\nbuilder: host\n', files: { 'build.sh': 'if [[ -n "${FULL:-}" ]]; then cp "$ROOT/../slicc-emscripten/x" .; fi\nemcc x.c\n' } },
    repacked: { recipe: 'name: repacked\nbuilder: host\nrepack:\n  from: "1.0.0-1"\n', files: { 'build.sh': 'emcc x.c\n' } },
    cone: { recipe: 'name: cone\nbuilder: slicc\n', files: { 'build.sh': 'emcc x.c\n' } },
  });
  try {
    mkdirSync(join(f.root, 'scripts'), { recursive: true });
    writeFileSync(join(f.root, 'scripts/build-gnu-cli.sh'), 'emmake make\n');
    writeFileSync(join(f.root, 'scripts/build-common.sh'), 'homescoop_x() { emcc "$@"; bash "$ROOT/scripts/install-wasixcc.sh"; }\n');
    for (const s of ['install-emsdk.sh', 'install-wasixcc.sh', 'install-go.sh']) writeFileSync(join(f.root, 'scripts', s), '\n');
    const cases = [
      [['shims/slicc/slicc_cred.c'], ['cxx', 'em', 'gnu', 'said2', 'slicc']],
      [['shims/slicc/slicc-fork.js'], ['cxx', 'em', 'gnu', 'said2', 'slicc']],
      [['scripts/emsdk-patches/libfs-symloop.patch'], ['cxx', 'em', 'gnu', 'said2', 'slicc']],
      [['scripts/install-emsdk.sh'], ['cxx', 'em', 'gnu', 'opt', 'said2', 'slicc']],
      [['scripts/build-gnu-cli.sh'], ['gnu']],
      [['scripts/install-wasixcc.sh'], ['wx']],
      [['scripts/install-go.sh'], ['go']],
      [['shims/slicc/README.md'], []],
      [['shims/slicc/test/nameinfo.test.mjs'], []],
      [['scripts/build-common.sh'], []],
    ];
    for (const [paths, want] of cases) {
      const r = f.touched(paths);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(JSON.parse(r.stdout), want, paths.join(' '));
    }
    const r = f.touched(['shims/slicc/slicc_cred.c', 'scripts/install-wasixcc.sh'], '--publishable');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), []);
  } finally {
    f.done();
  }
});

test('the real tree: cmake and emscripten-cache, built in CI since #859, get their toolchain inputs; wasixcc and Emscripten consumers keep theirs', async () => {
  const { toolchainInputs } = await import('../list-touched-packages.mjs');
  for (const want of ['shims/slicc/*.c', 'scripts/emscripten-tree.sh']) assert.ok(toolchainInputs('cmake').includes(want), `cmake: ${toolchainInputs('cmake').join(' ')}`);
  assert.deepEqual(toolchainInputs('emscripten-cache'), ['scripts/emscripten-tree.sh']);
  assert.ok(toolchainInputs('wasix-zlib').includes('scripts/install-wasixcc.sh'), `wasix-zlib: ${toolchainInputs('wasix-zlib').join(' ')}`);
  assert.ok(toolchainInputs('coreutils').includes('shims/slicc/*.c'), `coreutils: ${toolchainInputs('coreutils').join(' ')}`);
});
