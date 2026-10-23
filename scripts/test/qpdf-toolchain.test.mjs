import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const build = readFileSync(join(root, 'packages/qpdf/build.sh'), 'utf8');
const tree = readFileSync(join(root, 'scripts/emscripten-tree.sh'), 'utf8');

const atLeast = (v, min) => {
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

test('qpdf compiles on an LLVM with the CFG Stackify MapVector fix, emsdk 6.0.2 or later (homescoop#1354)', () => {
  assert.match(build, /-fwasm-exceptions/);
  assert.match(build, /eval "\$\(bash "\$ROOT\/scripts\/emscripten-tree\.sh" "\$WORK\/qpdf-em"\)"/, 'qpdf/build.sh does not build with scripts/emscripten-tree.sh');
  assert.match(build, /export PATH="\$EMSCRIPTEN_TREE:\$PATH"/, 'qpdf/build.sh does not put the emscripten tree first on PATH');
  assert.match(build, /export EM_CONFIG="\$EMSCRIPTEN_TREE_CONFIG"/);
  const m = tree.match(/grep -qx '(\d+\.\d+\.\d+)-git'/);
  assert.ok(m, 'scripts/emscripten-tree.sh does not check its emscripten version');
  assert.ok(atLeast(m[1], '6.0.2'), `scripts/emscripten-tree.sh pins emscripten ${m[1]}, before 6.0.2 (llvm-project fd76c9bdf103)`);
  const first = (re) => build.search(re);
  const path = first(/export PATH="\$EMSCRIPTEN_TREE:\$PATH"/);
  for (const use of [/homescoop_slicc_archive /, /homescoop_em_cli_ldflags\)/, /emcmake cmake/, /emmake make/]) {
    const at = first(use);
    assert.ok(at > path, `qpdf/build.sh uses ${use} before it switches to the emscripten tree`);
  }
  assert.match(build, /qpdf-toolchain: PASS/);
});

test('qpdf rebuilds when the emscripten tree or its patches change (homescoop#1354)', async () => {
  const { toolchainInputs } = await import('../list-touched-packages.mjs');
  assert.ok(toolchainInputs('qpdf').includes('scripts/emscripten-tree.sh'), toolchainInputs('qpdf').join(' '));
  const r = spawnSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), 'qpdf', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const inputs = JSON.parse(r.stdout).inputs || [];
  assert.ok(inputs.includes('packages/wasm-emscripten/patches/**'), inputs.join(' '));
  assert.ok(inputs.includes('packages/wasm-emscripten/package-patches/0014-libfs-symloop.patch'), inputs.join(' '));
});
