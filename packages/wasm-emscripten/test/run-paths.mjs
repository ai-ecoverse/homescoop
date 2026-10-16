#!/usr/bin/env node
// CI cert for a wasm-emscripten tarball (cert/meta.json harness host-node):
// does the package find its companions (wasm-clang, wasm-binaryen,
// emscripten-cache) where a package manager installs them? It runs on
// slicc-kernel's Node entry with the package and its exact dependencies from
// `npm install <tarball>`, laid out as --layout says:
//   flat  /node_modules/@ai-ecoverse/<pkg> (npm, slicc's `ipk add -g`);
//   pnpm  one `pnpm add -g` project under PNPM_HOME: wasm-emscripten real in
//         .pnpm/@ai-ecoverse+wasm-emscripten@<v>/node_modules/@ai-ecoverse/,
//         its dependencies symlinked beside it into their own .pnpm dirs, the
//         project's node_modules/@ai-ecoverse/wasm-emscripten a symlink.
// wasix-python, wasm-bash and wasm-coreutils sit flat in /node_modules (the
// commands that run em-config and em-ensure-cache).
//
// Checks (no compile: emcc does not run on slicc-kernel yet, slicc-kernel#390):
// `em-config LLVM_ROOT` is a real directory with clang (and no `..`),
// `em-config BINARYEN_ROOT` has bin/wasm-opt, and `em-ensure-cache` links
// ~/.cache/emscripten/sysroot into emscripten-cache so include/stdio.h reads
// through it. In the pnpm layout the roots are the .pnpm store copies.
//
//   node packages/wasm-emscripten/test/run-paths.mjs --tarball .homescoop-out/package.tgz [--layout flat|pnpm]
//   node packages/wasm-emscripten/test/run-paths.mjs --tarball @ai-ecoverse/wasm-emscripten@6.0.9-17 --expect old
//
// --expect old is the negative: 6.0.9-17's slicc.env points at
// /shared/lib/node_modules/@ai-ecoverse/<dep>, which npm never fills: every
// launcher (em-config included) stops in em-ensure-cache with "missing sysroot
// at /shared/lib/…".
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(join(here, '../cert/meta.json'), 'utf8'));
const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!arg('--tarball')) {
  console.error('usage: run-paths.mjs --tarball <wasm-emscripten package.tgz | npm spec> [--layout flat|pnpm] [--expect current|old] [--kernel <npm spec>]');
  process.exit(2);
}
const expect = arg('--expect') ?? 'current';
if (!['current', 'old'].includes(expect)) throw new Error('--expect current|old');
const layout = arg('--layout') ?? 'flat';
if (!['flat', 'pnpm'].includes(layout)) throw new Error('--layout flat|pnpm');
const kernelSpec = arg('--kernel') ?? meta.kernel;
const S = '@ai-ecoverse';
const DEPS = ['wasm-clang', 'wasm-binaryen', 'emscripten-cache'];
const FLAT = ['wasix-python', ...meta.needs.map((n) => n.slice(S.length + 1))];
const PNPM_G = '/usr/local/share/pnpm/global/v11';
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString();

const work = mkdtempSync(join(tmpdir(), 'wasm-emscripten-paths-'));
let k;
try {
  const nmRoot = join(work, 'nm');
  mkdirSync(nmRoot, { recursive: true });
  const tarball = statSync(resolve(arg('--tarball')), { throwIfNoEntry: false }) ? resolve(arg('--tarball')) : arg('--tarball');
  sh('npm', ['install', '--prefix', nmRoot, '--no-fund', '--no-audit', '--silent', tarball, kernelSpec, ...meta.needsInstall]);
  const nm = join(nmRoot, 'node_modules');
  const man = (n) => JSON.parse(readFileSync(join(nm, S, n, 'package.json'), 'utf8'));
  const em = man('wasm-emscripten');
  console.log(`== ${em.name}@${em.version}, ${kernelSpec}, layout ${layout}, expect ${expect}`);
  for (const d of DEPS) console.log(`   slicc.env ${d}: ${JSON.stringify(Object.entries(em.slicc.env).find(([, v]) => v.endsWith(d))?.[1] ?? null)} (installed ${man(d).version})`);

  const kroot = join(nm, `${S}/slicc-kernel`);
  const kver = JSON.parse(readFileSync(join(kroot, 'package.json'), 'utf8')).version;
  const { createNodeKernel } = await import(pathToFileURL(join(kroot, 'dist/node.js')).href);
  k = await createNodeKernel({});
  let files = 0;
  const copyTree = async (src, dest) => {
    for (const e of readdirSync(src)) {
      const p = join(src, e);
      const st = statSync(p);
      // The tools are not run here: skip the big wasm modules and node_modules.
      if (st.isDirectory() && e !== 'node_modules') await copyTree(p, `${dest}/${e}`);
      else if (st.isFile() && !(e.endsWith('.wasm') && /wasm-(clang|binaryen)/.test(p))) { await k.writeFile(`${dest}/${e}`, readFileSync(p)); files++; }
    }
  };
  const run = (argv, o = {}) => k.run(argv, { cwd: o.cwd ?? '/home', env: { HOME: '/home', TMPDIR: '/tmp', ...o.env } });
  for (const n of FLAT) await copyTree(join(nm, S, n), `/node_modules/${S}/${n}`);
  let storeOf = (n) => `/node_modules/${S}/${n}`;
  if (layout === 'flat') {
    for (const n of ['wasm-emscripten', ...DEPS]) await copyTree(join(nm, S, n), storeOf(n));
  } else {
    const proj = `${PNPM_G}/wasm-emscripten`;
    storeOf = (n) => `${proj}/node_modules/.pnpm/${S}+${n}@${man(n).version}/node_modules/${S}/${n}`;
    for (const n of ['wasm-emscripten', ...DEPS]) await copyTree(join(nm, S, n), storeOf(n));
    await k.writeFile(`${proj}/package.json`, JSON.stringify({ dependencies: { [em.name]: em.version } }));
    const beside = dirname(storeOf('wasm-emscripten'));
    const r = await run(['bash', '-c', [
      'set -e',
      ...DEPS.map((n) => `ln -s ${storeOf(n)} ${beside}/${n}`),
      `mkdir -p ${proj}/node_modules/${S}`,
      `ln -s ../.pnpm/${S}+wasm-emscripten@${em.version}/node_modules/${S}/wasm-emscripten ${proj}/node_modules/${S}/wasm-emscripten`,
    ].join('\n')], { cwd: '/' });
    assert.equal(r.status, 0, `pnpm layout: ${r.stderr}`);
  }
  console.log(`== kernel ${kver} (Node entry): ${files} files installed`);

  // em-config is a command once the kernel has scanned the package.
  let r;
  for (let i = 0; ; i++) {
    r = await run(['em-config', 'LLVM_ROOT']);
    if (r.status === 0 || i >= 100 || /em-ensure-cache|em-launcher/.test(r.stderr)) break;
    await new Promise((res) => setTimeout(res, 200));
  }
  if (expect === 'old') {
    console.log(`   em-config LLVM_ROOT rc=${r.status}: ${(r.stdout + r.stderr).trim()}`);
    assert.notEqual(r.status, 0, 'em-config must fail on -17 in an npm layout');
    assert.match(r.stderr, /missing sysroot at \/shared\/lib\/node_modules\/@ai-ecoverse\/emscripten-cache\/sysroot/, r.stderr);
    const clang = await run(['test', '-e', `/shared/lib/node_modules/${S}/wasm-clang/bin/clang`]);
    assert.notEqual(clang.status, 0, '/shared/lib/…/wasm-clang/bin/clang must be missing');
    console.log(`PASS negative: ${em.name}@${em.version} (${layout}) looks under /shared/lib/node_modules, which an npm install never fills`);
  } else {
  assert.equal(r.status, 0, `em-config LLVM_ROOT: rc=${r.status} ${r.stdout}${r.stderr}`);
  const llvm = r.stdout.trim();
  const binaryen = (await run(['em-config', 'BINARYEN_ROOT'])).stdout.trim();
  const cache = await run(['bash', '-c', 'em-ensure-cache && ls -ld "$HOME/.cache/emscripten/sysroot" && test -r "$HOME/.cache/emscripten/sysroot/include/stdio.h" && head -c 0 "$HOME/.cache/emscripten/sysroot/include/stdio.h" && echo stdio.h readable']);
  console.log(`   LLVM_ROOT ${llvm}\n   BINARYEN_ROOT ${binaryen}\n   em-ensure-cache rc=${cache.status}: ${(cache.stdout + cache.stderr).trim().split('\n').join(' | ')}`);
  const exists = async (p) => (await run(['test', '-f', p])).status === 0;

  {
    assert.equal(llvm, `${storeOf('wasm-clang')}/bin`, 'LLVM_ROOT is the installed wasm-clang/bin');
    assert.equal(binaryen, storeOf('wasm-binaryen'), 'BINARYEN_ROOT is the installed wasm-binaryen');
    assert.ok(!llvm.includes('..') && !binaryen.includes('..'), 'roots are resolved (no ..)');
    assert.ok(await exists(`${llvm}/clang`), `${llvm}/clang exists`);
    assert.ok(await exists(`${binaryen}/bin/wasm-opt`), `${binaryen}/bin/wasm-opt exists`);
    assert.equal(cache.status, 0, `em-ensure-cache: ${cache.stdout}${cache.stderr}`);
    assert.ok(cache.stdout.includes('stdio.h readable'), cache.stdout);
    let ran = '';
    if (layout === 'flat') {
      // The tools emcc drives, run through their glue on this kernel (1.61.0
      // still exposes process to the worker): from 6.0.9-19 they are the
      // releases whose Node-host runner stays out of it (homescoop#276).
      // Flat only: the kernel lists commands from /node_modules.
      for (const [n, f] of [['wasm-clang', 'bin/llvm.wasm'], ['wasm-binaryen', 'bin/wasm-opt.wasm']]) {
        await k.writeFile(`${storeOf(n)}/${f}`, readFileSync(join(nm, S, n, f)));
      }
      for (const [tool, want] of [['clang', /clang version 24\./], ['wasm-opt', /^wasm-opt version 132\b/]]) {
        const v = await run([tool, '--version']);
        assert.equal(v.status, 0, `${tool} --version (${man(tool === 'clang' ? 'wasm-clang' : 'wasm-binaryen').version}): rc=${v.status}\n${v.stdout}${v.stderr}`);
        assert.match(v.stdout, want, `${tool} --version: ${v.stdout}${v.stderr}`);
        assert.equal(v.stderr, '', `${tool} --version printed on stderr (the glue's Node-host runner ran a second main?): ${v.stderr}`);
      }
      ran = `; clang ${man('wasm-clang').version} and wasm-opt ${man('wasm-binaryen').version} --version run clean through their glue on slicc-kernel ${kver}`;
    }
    console.log(`PASS ${em.name}@${em.version} (${layout}): clang, wasm-opt and the cache sysroot found beside the package${ran}`);
  }
  }
} catch (e) {
  process.exitCode = 1;
  console.log(`FAIL ${e.stack}`);
} finally {
  if (k) await k.terminate();
  rmSync(work, { recursive: true, force: true });
}
