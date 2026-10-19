#!/usr/bin/env node
// C++ exceptions through wasm-clang in every EH tree of the wasix-sysroot it
// pins (homescoop#965). The package's own c++ driver, run by wasm-bash in
// slicc-kernel's Node entry under users enforce, builds wasix-sysroot's
// test/cxx-eh.cpp (throw/catch across frames, destructors on unwind,
// std::out_of_range, rethrow of a saved exception_ptr, a throw inside a
// std::thread, thread_local) and test/cxx-terminate.cpp (std::terminate
// through a handler) with nothing but the driver's environment:
//   sysroot-exnref-eh     WASIXCC_WASM_EXCEPTIONS=exnref WASIXCC_PIC=no
//   sysroot-exnref-ehpic  WASIXCC_WASM_EXCEPTIONS=exnref WASIXCC_PIC=yes WASIXCC_ASYNCIFY=0
//   sysroot-eh            WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=no
//   sysroot-ehpic         WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes
// No -mllvm flags of the caller's: the driver has to pick the EH encoding
// that matches the tree (--wasm-use-legacy-eh=true for legacy, at compile and
// at link). The legacy PIC tree is asyncified by the driver (wasm-opt from
// the pinned wasm-binaryen), as any fork-capable program is; binaryen's
// Asyncify can't take exnref code, so the exnref PIC tree opts out with
// WASIXCC_ASYNCIFY=0, as wasix-sysroot's own test/cxx-eh.mjs does.
//
//   node packages/wasm-clang/test/cxx-eh.mjs --tarball .homescoop-out/package.tgz
//   node packages/wasm-clang/test/cxx-eh.mjs --tarball @ai-ecoverse/wasm-clang@24.0.0-21 --sysroot-version 2025.9.30-38 --expect old
//
// --expect old is the negative: 24.0.0-21's driver emits exnref code even for
// WASIXCC_WASM_EXCEPTIONS=legacy, so on a -33+ sysroot (legacy-EH runtimes in
// sysroot-eh/ehpic) both legacy trees fail: the sysroot-eh program does not
// load, and the sysroot-ehpic link aborts in wasm-opt --asyncify.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const sources = join(here, '../../wasix-sysroot/test');
const meta = JSON.parse(readFileSync(join(here, '../cert/meta.json'), 'utf8'));
const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!arg('--tarball')) {
  console.error('usage: cxx-eh.mjs --tarball <wasm-clang package.tgz | npm spec> [--sysroot-version <v>] [--kernel <npm spec>] [--expect current|old]');
  process.exit(2);
}
const expect = arg('--expect') ?? 'current';
if (!['current', 'old'].includes(expect)) throw new Error('--expect current|old');
const kernelSpec = arg('--kernel') ?? meta.kernel;
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26, ...opts }).toString();
const S = '@ai-ecoverse';
const EH = [
  ['sysroot-exnref-eh', { WASIXCC_WASM_EXCEPTIONS: 'exnref', WASIXCC_PIC: 'no' }],
  ['sysroot-exnref-ehpic', { WASIXCC_WASM_EXCEPTIONS: 'exnref', WASIXCC_PIC: 'yes', WASIXCC_ASYNCIFY: '0' }],
  ['sysroot-eh', { WASIXCC_WASM_EXCEPTIONS: 'legacy', WASIXCC_PIC: 'no' }],
  ['sysroot-ehpic', { WASIXCC_WASM_EXCEPTIONS: 'legacy', WASIXCC_PIC: 'yes' }],
];
const WANT = 'caught=117107 dtors=2 tl=tls seen=in thread';

function unpack(spec, dir, members = []) {
  mkdirSync(dir, { recursive: true });
  let tgz = resolve(spec);
  if (!statSync(tgz, { throwIfNoEntry: false })) {
    tgz = join(dir, sh('npm', ['pack', '--silent', '--pack-destination', dir, spec]).trim().split('\n').pop());
  }
  sh('tar', ['xzf', tgz, '-C', dir, ...members]);
  return join(dir, 'package');
}

const work = mkdtempSync(join(tmpdir(), 'wasm-clang-cxx-eh-'));
let k;
try {
  const clang = unpack(arg('--tarball'), join(work, 'clang'));
  const cpkg = JSON.parse(readFileSync(join(clang, 'package.json'), 'utf8'));
  const sysVer = arg('--sysroot-version') ?? cpkg.dependencies?.[`${S}/wasix-sysroot`];
  const binVer = cpkg.dependencies?.[`${S}/wasm-binaryen`];
  assert.ok(sysVer && binVer, 'wasm-clang package.json pins no wasix-sysroot or wasm-binaryen');
  console.log(`== ${cpkg.name}@${cpkg.version}, wasix-sysroot ${sysVer}, wasm-binaryen ${binVer}, ${kernelSpec}, users enforce, expect ${expect}`);
  const sys = unpack(`${S}/wasix-sysroot@${sysVer}`, join(work, 'sysroot'), ['package/package.json', ...EH.map(([v]) => `package/${v}`)]);
  const binaryen = unpack(`${S}/wasm-binaryen@${binVer}`, join(work, 'binaryen'));

  const nm = join(work, 'nm');
  mkdirSync(nm, { recursive: true });
  sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', kernelSpec, ...meta.needsInstall]);
  const kroot = join(nm, `node_modules/${S}/slicc-kernel`);
  const kver = JSON.parse(readFileSync(join(kroot, 'package.json'), 'utf8')).version;
  const { createNodeKernel } = await import(pathToFileURL(join(kroot, 'dist/node.js')).href);
  k = await createNodeKernel({ users: 'enforce' });
  let files = 0;
  const copyTree = async (src, dest) => {
    for (const e of readdirSync(src)) {
      const p = join(src, e);
      if (statSync(p).isDirectory()) await copyTree(p, `${dest}/${e}`);
      else { await k.writeFile(`${dest}/${e}`, readFileSync(p)); files++; }
    }
  };
  for (const need of meta.needs) await copyTree(join(nm, 'node_modules', need), `/node_modules/${need}`);
  await copyTree(clang, `/node_modules/${S}/wasm-clang`);
  await copyTree(binaryen, `/node_modules/${S}/wasm-binaryen`);
  await copyTree(sys, `/node_modules/${S}/wasix-sysroot`);
  console.log(`== kernel ${kver} (Node entry): ${files} files installed`);
  const run = (argv, o = {}) => k.run(argv, { cwd: o.cwd || '/home', env: o.env || {}, stdin: o.stdin });
  const ccEnv = { TMPDIR: '/tmp' };
  for (let i = 0; ; i++) {
    const r = await run(['c++', '--version'], { env: ccEnv });
    if (r.status === 0) break;
    if (i >= 100) assert.fail(`c++ --version: rc=${r.status} ${r.stdout}${r.stderr}`);
    await new Promise((res) => setTimeout(res, 200));
  }
  for (const f of ['cxx-eh.cpp', 'cxx-terminate.cpp']) await k.writeFile(`/home/${f}`, readFileSync(join(sources, f)));

  const built = [];
  const failed = [];
  for (const [tree, env] of EH) {
    const t0 = Date.now();
    let ok = true;
    for (const [src, tag] of [['cxx-eh.cpp', 'eh'], ['cxx-terminate.cpp', 'term']]) {
      const r = await run(['c++', '-O2', '-pthread', src, '-o', `/home/${tree}.${tag}.wasm`], { env: { ...ccEnv, ...env } });
      if (r.status !== 0) {
        ok = false;
        failed.push(`${tree} ${src}: rc=${r.status} ${`${r.stderr}`.trim().split('\n').slice(-3).join(' | ')}`);
        break;
      }
    }
    if (!ok) continue;
    const eh = await run(['bash', '-c', `/home/${tree}.eh.wasm; echo rc=$?`], { env: ccEnv });
    if (eh.stdout.trim() !== `${WANT}\nrc=0`) {
      failed.push(`${tree} cxx-eh.wasm ran: ${JSON.stringify(eh.stdout.trim())} ${`${eh.stderr}`.trim().split('\n').slice(-2).join(' | ')}`);
      continue;
    }
    const term = await run(['bash', '-c', `/home/${tree}.term.wasm; echo rc=$?`], { env: ccEnv });
    if (term.stdout.trim() !== 'throwing\nterminate handler ran\nrc=137') {
      failed.push(`${tree} cxx-terminate.wasm ran: ${JSON.stringify(term.stdout.trim())} ${`${term.stderr}`.trim().split('\n').slice(-2).join(' | ')}`);
      continue;
    }
    built.push(`${tree} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  if (expect === 'current') {
    assert.deepEqual(failed, [], `c++ failed in ${failed.length} tree(s):\n${failed.join('\n')}`);
    console.log(`PASS ${cpkg.name}@${cpkg.version}: C++ exceptions (${WANT}) and std::terminate through a handler in all ${built.length} EH trees of wasix-sysroot ${sysVer}, env vars only: ${built.join(', ')}`);
  } else {
    const legacyFailed = ['sysroot-eh', 'sysroot-ehpic'].filter((t) => failed.some((f) => f.startsWith(`${t} `)));
    assert.deepEqual(legacyFailed, ['sysroot-eh', 'sysroot-ehpic'], `expected both legacy trees to fail with ${cpkg.version}'s driver (exnref code against legacy-EH runtimes); passed: ${built.join(', ')}`);
    console.log(`PASS negative: ${cpkg.name}@${cpkg.version} on wasix-sysroot ${sysVer}: ${failed.join('; ')}`);
  }
} catch (e) {
  process.exitCode = 1;
  console.log(`FAIL ${e.stack}`);
} finally {
  if (k) await k.terminate();
  rmSync(work, { recursive: true, force: true });
}
