import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { peerTarball } from '../../../scripts/peer-tarball.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
const spec = arg('--tarball');
const expect = arg('--expect') ?? 'current';
if (!spec || !['current', 'old'].includes(expect)) {
  console.error('usage: main-module.mjs --tarball <wasm-emscripten package.tgz | npm spec> [--expect current|old]');
  process.exit(2);
}
const sh = (cmd, argv, o = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26, ...o }).toString();
const work = mkdtempSync(join(tmpdir(), 'wasm-emscripten-main-module-'));
const treeCache = process.env.HOMESCOOP_EM_TREE_CACHE || join(work, 'tree');
const pack = (s, into) => {
  const p = resolve(s);
  if (statSync(p, { throwIfNoEntry: false })) return p;
  mkdirSync(into, { recursive: true });
  return join(into, sh('npm', ['pack', '--silent', '--pack-destination', into, s]).trim().split('\n').pop());
};
const untar = (tgz, into) => {
  mkdirSync(into, { recursive: true });
  sh('tar', ['xzf', tgz, '-C', into]);
  return join(into, 'package');
};
let code = 1;
try {
  const em = untar(pack(spec, join(work, 'npm')), join(work, 'em'));
  const manifest = JSON.parse(readFileSync(join(em, 'package.json'), 'utf8'));
  const pin = manifest.dependencies?.['@ai-ecoverse/emscripten-cache'];
  assert.match(pin || '', /^\d+\.\d+\.\d+-\d+$/, `${manifest.name}@${manifest.version} does not pin @ai-ecoverse/emscripten-cache exactly`);
  const recipeCache = JSON.parse(readFileSync(join(root, 'packages/emscripten-cache/package/package.json'), 'utf8')).version;
  const cacheSpec = pin === recipeCache ? peerTarball('emscripten-cache') : `@ai-ecoverse/emscripten-cache@${pin}`;
  const cachePkg = untar(pack(cacheSpec, join(work, 'npm')), join(work, 'cache-pkg'));
  console.log(`== ${manifest.name}@${manifest.version} with its pinned emscripten-cache ${pin} (${cacheSpec}), installed read-only, expect ${expect}`);
  sh('chmod', ['-R', 'a-w', cachePkg]);

  const out = sh('bash', [join(root, 'scripts/emscripten-tree.sh'), treeCache], { stdio: ['ignore', 'pipe', 'inherit'] });
  const ex = Object.fromEntries(out.trim().split('\n').map((l) => l.replace(/^export /, '').split('=')).map(([k, ...v]) => [k, v.join('=').replace(/^'(.*)'$/, '$1')]));
  const toolchain = dirname(ex.EMSDK_RELEASE_LLVM);
  if (!existsSync(join(work, 'em', 'node_modules'))) symlinkSync(join(treeCache, 'node_modules'), join(work, 'em', 'node_modules'));

  const home = join(work, 'home');
  mkdirSync(home);
  const env = {
    ...process.env,
    HOME: home,
    EM_CACHE: join(home, '.cache/emscripten'),
    EM_PACKAGE_ROOT: em,
    EM_CONFIG: join(em, 'emscripten-config'),
    EM_CACHE_PACKAGE: cachePkg,
    EM_LLVM_PACKAGE: toolchain,
    EM_BINARYEN_PACKAGE: toolchain,
  };
  delete env.SLICC_EMCC_PLAIN;
  delete env.SLICC_EM_LIBDIR;
  delete env.EMCC_CFLAGS;
  const cache = sh('sh', [join(em, 'bin/em-ensure-cache')], { env }).trim();
  assert.equal(cache, env.EM_CACHE, 'em-ensure-cache prints EM_CACHE');
  assert.equal(readFileSync(join(cache, 'sysroot/include/stdio.h'), 'utf8').length > 0, true, 'the cache sysroot reads through em-ensure-cache\'s symlink');

  const run = join(work, 'run');
  mkdirSync(run);
  writeFileSync(join(run, 'hello.c'), '#include <stdio.h>\n#include <unistd.h>\nint main(void) { printf("hello main module %d\\n", getpid() > 0); return 0; }\n');
  writeFileSync(join(run, 'side.c'), 'int side_answer(void) { return 42; }\n');
  writeFileSync(join(run, 'dl.c'), '#include <dlfcn.h>\n#include <stdio.h>\nint main(void) {\n  void *h = dlopen("/side.wasm", RTLD_NOW);\n  if (!h) { printf("dlopen %s\\n", dlerror()); return 1; }\n  int (*f)(void) = (int (*)(void))dlsym(h, "side_answer");\n  printf("side %d\\n", f ? f() : -1);\n  return 0;\n}\n');
  const emcc = (argv) => spawnSync('python3', [join(em, 'emcc.py'), ...argv], { cwd: run, env, encoding: 'utf8', maxBuffer: 1 << 26 });
  const node = (js) => sh(process.execPath, [js], { cwd: run });

  const plain = emcc(['hello.c', '-o', 'hello.js']);
  assert.equal(plain.status, 0, `the default link fails against the read-only cache: ${plain.stderr}`);
  assert.equal(node('hello.js'), 'hello main module 1\n');
  const main = emcc(['-sMAIN_MODULE=1', 'hello.c', '-o', 'main.js']);
  const permission = /PermissionError|Permission denied/.exec(main.stderr);
  if (expect === 'old') {
    assert.notEqual(main.status, 0, `-sMAIN_MODULE=1 links against ${pin}, which ships no pic libraries; this row no longer tests homescoop#1699`);
    assert.ok(permission, `-sMAIN_MODULE=1 fails, but not with a PermissionError: ${main.stderr.split('\n').slice(-6).join(' | ')}`);
    const line = main.stderr.split('\n').find((l) => /Permission/.test(l));
    console.log(`   -sMAIN_MODULE=1 rc=${main.status}: ${line}`);
    console.log(`PASS negative: ${manifest.name}@${manifest.version}'s pinned emscripten-cache ${pin} has no sysroot/lib/wasm32-emscripten/pic, so -sMAIN_MODULE=1 tries to build pic libraries into the read-only package`);
  } else {
    assert.equal(main.status, 0, `-sMAIN_MODULE=1 hello.c does not link against the read-only pinned cache (homescoop#1699): ${main.stderr.split('\n').slice(-8).join(' | ')}`);
    assert.equal(node('main.js'), 'hello main module 1\n', '-sMAIN_MODULE=1 hello runs');
    const side = emcc(['-O2', '-sSIDE_MODULE=1', 'side.c', '-o', 'side.wasm']);
    assert.equal(side.status, 0, `-sSIDE_MODULE=1 side.c: ${side.stderr}`);
    const dl = emcc(['-sMAIN_MODULE=1', 'dl.c', '--embed-file', 'side.wasm@/side.wasm', '-o', 'dl.js']);
    assert.equal(dl.status, 0, `-sMAIN_MODULE=1 dl.c: ${dl.stderr.split('\n').slice(-8).join(' | ')}`);
    assert.equal(node('dl.js'), 'side 42\n', 'the main module dlopens the side module and calls it');
    console.log(`   EM_CACHE holds ${readdirSync(cache).sort().join(', ')}; sysroot is the read-only package's`);
    console.log(`PASS ${manifest.name}@${manifest.version}: with its pinned emscripten-cache ${pin} read-only behind em-ensure-cache, a default link, -sMAIN_MODULE=1 hello and a dlopen of a -sSIDE_MODULE link with the slicc defaults and run`);
  }
  code = 0;
} catch (e) {
  console.log(`FAIL ${e.stack}${e.stderr ? `\n${e.stderr}` : ''}`);
} finally {
  spawnSync('chmod', ['-R', 'u+w', work]);
  rmSync(work, { recursive: true, force: true });
}
process.exit(code);
