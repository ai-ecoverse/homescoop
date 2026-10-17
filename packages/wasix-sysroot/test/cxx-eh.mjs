#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ptySession } from '../../../scripts/browser-cert/context.mjs';
import { sysroot, wasixcc } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(join(here, '../../wasm-clang/cert/meta.json'), 'utf8'));
const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!arg('--tarball') || !arg('--sysroot')) {
  console.error('usage: cxx-eh.mjs --sysroot <wasix-sysroot package.tgz> --tarball <wasm-clang package.tgz | npm spec> [--kernel <npm spec>]');
  process.exit(2);
}
const expect = arg('--expect') ?? 'current';
if (!['current', 'old'].includes(expect)) throw new Error('--expect current|old');
const layout = arg('--layout') ?? (expect === 'old' ? 'shared' : 'flat');
if (!['flat', 'pnpm', 'shared'].includes(layout)) throw new Error('--layout flat|pnpm|shared');
const kernelSpec = arg('--kernel') ?? meta.kernel;
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString();
const S = '@ai-ecoverse';
const PNPM_G = '/usr/local/share/pnpm/global/v11';
const PROBES_AT = '/node_modules/wasm-clang-cc-probes';
const VARIANT = 'sysroot-exnref-eh'; // bin/cc's default (exnref EH, no PIC)

/** Unpack an npm tarball (path or spec) into dir; returns dir/package. */
function unpack(spec, dir, members = []) {
  mkdirSync(dir, { recursive: true });
  let tgz = resolve(spec);
  if (!statSync(tgz, { throwIfNoEntry: false })) {
    tgz = join(dir, sh('npm', ['pack', '--silent', '--pack-destination', dir, spec]).trim().split('\n').pop());
  }
  sh('tar', ['xzf', tgz, '-C', dir, ...members]);
  return join(dir, 'package');
}

const RUNNER = '\n// Node runs the tool immediately.';
const UNGUARDED = "if (typeof process !== 'undefined' && process.versions && process.versions.node) {";
const GUARDED = "if (typeof process !== 'undefined' && process.versions && process.versions.node && !Module['noInitialRun']) {";
/**
 * slicc-emscripten's appended Node-host runner in each glue file of pkg/bin:
 * [file, 'guarded' | 'unguarded', shipped sha256] for every glue that has one.
 */
function glueRunners(pkg) {
  const out = [];
  for (const f of readdirSync(join(pkg, 'bin'))) {
    const p = join(pkg, 'bin', f);
    if (!statSync(p).isFile() || f.endsWith('.wasm')) continue;
    const s = readFileSync(p, 'utf8');
    const i = s.indexOf(RUNNER);
    if (i < 0) continue;
    const tail = s.slice(i);
    const kind = tail.includes(GUARDED) ? 'guarded' : tail.includes(UNGUARDED) ? 'unguarded' : undefined;
    assert.ok(kind && tail.includes("Module['onRuntimeInitialized'] = function sliccNodeMain()") && /\n  \};\n\}\n*$/.test(tail),
      `bin/${f}: the appended block is not the expected sliccNodeMain runner`);
    out.push([f, kind, createHash('sha256').update(s).digest('hex')]);
  }
  return out;
}
/** Cut the unguarded runners off (cert only; see the header). Returns the files cut. */
function neutraliseGlue(pkg) {
  const done = [];
  for (const [f, kind] of glueRunners(pkg)) {
    if (kind !== 'unguarded') continue;
    const p = join(pkg, 'bin', f);
    const s = readFileSync(p, 'utf8');
    writeFileSync(p, `${s.slice(0, s.indexOf(RUNNER))}\n`);
    done.push(f);
  }
  return done;
}

const FORK_IMPORTS = ['proc_fork', 'stack_checkpoint', 'stack_restore'];

/** The slicc.libc custom section of a wasm module, or undefined. */
function libcMarker(buf) {
  let p = 8;
  const u32 = () => {
    let r = 0, s = 0, b;
    do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80);
    return r >>> 0;
  };
  while (p < buf.length) {
    const id = buf[p++];
    const size = u32();
    const end = p + size;
    if (id === 0) {
      const n = u32();
      const name = buf.toString('utf8', p, p + n);
      if (name === 'slicc.libc') return buf.toString('utf8', p + n, end);
    }
    p = end;
  }
  return undefined;
}

const work = mkdtempSync(join(tmpdir(), 'wasm-clang-cc-'));
let k;
try {
  const clang = unpack(arg('--tarball'), join(work, 'clang'));
  const cpkg = JSON.parse(readFileSync(join(clang, 'package.json'), 'utf8'));
  const runners = glueRunners(clang);
  assert.ok(runners.some(([f]) => f === 'llvm'), 'bin/llvm has no Node-host runner (did the glue change? update glueRunners)');
  if (expect === 'current') {
    const bad = runners.filter(([, kind]) => kind !== 'guarded').map(([f]) => f);
    assert.deepEqual(bad, [], `glue whose Node-host runner fires in slicc-kernel's Node process worker (no noInitialRun guard, homescoop#276): ${bad.join(', ')}`);
    console.log(`== glue as shipped: ${runners.length} files with the noInitialRun-guarded runner, bin/llvm sha256 ${runners.find(([f]) => f === 'llvm')[2]}`);
  } else {
    const cut = neutraliseGlue(clang);
    console.log(`== glue neutralised for the Node entry (cert only, --expect old): ${cut.length} files`);
  }
  const sysVer = cpkg.dependencies?.[`${S}/wasix-sysroot`];
  assert.ok(sysVer, 'wasm-clang package.json has no @ai-ecoverse/wasix-sysroot dependency');
  console.log(`== ${cpkg.name}@${cpkg.version}, wasix-sysroot ${sysVer}, ${kernelSpec}, users enforce, layout ${layout}, expect ${expect}`);
  console.log(`== slicc.env WASIXCC_SYSROOT_PREFIX ${JSON.stringify(cpkg.slicc?.env?.WASIXCC_SYSROOT_PREFIX ?? null)}`);
  const sys = unpack(resolve(arg('--sysroot')), join(work, 'sysroot'), ['package/package.json', 'package/sysroot-eh', 'package/sysroot-ehpic', 'package/sysroot-exnref-eh', 'package/sysroot-exnref-ehpic']);
  const hostSys = sysroot(resolve(arg('--sysroot')), join(work, 'host-sysroot'));
  const binVer = cpkg.dependencies?.[`${S}/wasm-binaryen`];
  const binaryen = layout === 'flat' && binVer ? unpack(`${S}/wasm-binaryen@${binVer}`, join(work, 'binaryen')) : undefined;
  if (binaryen) {
    const cut = neutraliseGlue(binaryen);
    console.log(`== wasm-binaryen ${binVer}: ${cut.length ? `unguarded runner cut off (cert only) in ${cut.join(', ')}` : 'glue as shipped'}`);
  }

  const nm = join(work, 'nm');
  mkdirSync(nm, { recursive: true });
  sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', kernelSpec, ...meta.needsInstall]);
  const kroot = join(nm, `node_modules/${S}/slicc-kernel`);
  const kver = JSON.parse(readFileSync(join(kroot, 'package.json'), 'utf8')).version;
  const { createNodeKernel } = await import(pathToFileURL(join(kroot, 'dist/node.js')).href);
  k = await createNodeKernel({ users: 'enforce' });
  let files = 0;
  const copyTree = async (src, dest, skip = () => false) => {
    for (const e of readdirSync(src)) {
      const p = join(src, e);
      if (skip(p)) continue;
      if (statSync(p).isDirectory()) await copyTree(p, `${dest}/${e}`, skip);
      else { await k.writeFile(`${dest}/${e}`, readFileSync(p)); files++; }
    }
  };
  for (const need of meta.needs) await copyTree(join(nm, 'node_modules', need), `/node_modules/${need}`);
  const run = (argv, o = {}) => k.run(argv, { cwd: o.cwd || '/home', env: o.env || {}, stdin: o.stdin, ...(o.user !== undefined && { user: o.user }) });
  const noCxx = () => false;
  if (layout === 'pnpm') {
    const proj = `${PNPM_G}/wasm-clang`;
    const store = `${proj}/node_modules/.pnpm/${S}+wasm-clang@${cpkg.version}/node_modules/${S}`;
    await copyTree(clang, `${store}/wasm-clang`);
    await copyTree(sys, `${store}/wasix-sysroot`, noCxx);
    await k.writeFile(`${proj}/package.json`, JSON.stringify({ dependencies: { [cpkg.name]: cpkg.version } }));
    const ln = await run(['bash', '-c', `mkdir -p ${proj}/node_modules/${S} && ln -s ../.pnpm/${S}+wasm-clang@${cpkg.version}/node_modules/${S}/wasm-clang ${proj}/node_modules/${S}/wasm-clang && ls -l ${proj}/node_modules/${S}`], { cwd: '/' });
    assert.equal(ln.status, 0, `pnpm layout: ${ln.stderr}`);
    console.log(`== pnpm layout: ${ln.stdout.trim().split('\n').pop()}`);
  } else {
    await copyTree(clang, `/node_modules/${S}/wasm-clang`);
    if (binaryen) await copyTree(binaryen, `/node_modules/${S}/wasm-binaryen`);
    await copyTree(sys, layout === 'flat' ? `/node_modules/${S}/wasix-sysroot` : `/shared/lib/node_modules/${S}/wasix-sysroot`, noCxx);
  }
  console.log(`== kernel ${kver} (Node entry): ${files} files installed`);
  // The kernel picks up new packages (PNPM_HOME projects via its watcher).
  for (let i = 0; ; i++) {
    const r = await run(['wasixcc', '--version'], { env: { TMPDIR: '/tmp' } });
    if (r.status === 0) break;
    if (i >= 100) assert.fail(`wasixcc --version: rc=${r.status} ${r.stdout}${r.stderr}`);
    await new Promise((res) => setTimeout(res, 200));
  }
  if (expect === 'current') {
    // The shipped glue on the Node entry: the kernel's callMain runs the tool.
    for (const [tool, want] of [['clang', /^clang version 24\./m], ['wasm-ld', /^LLD 24\./m], ['llvm-nm', /LLVM version 24\./]]) {
      const r = await run([tool, '--version'], { env: { TMPDIR: '/tmp' } });
      assert.equal(r.status, 0, `${tool} --version through the shipped glue: rc=${r.status}\n${r.stdout}${r.stderr}`);
      assert.match(r.stdout, want, `${tool} --version: ${r.stdout}${r.stderr}`);
    }
    console.log('== clang, wasm-ld and llvm-nm --version run through the shipped glue');
    const g = await run(['bash', '-c', 'command -v grep || echo "no grep"']);
    assert.equal(g.stdout, 'no grep\n', `the realm has grep (the Asyncify check must not need it): ${g.stdout}`);
  }
  const ccEnv = { TMPDIR: '/tmp' };
  const EH = [
    ['sysroot-exnref-eh', { WASIXCC_WASM_EXCEPTIONS: 'exnref', WASIXCC_PIC: 'no' }],
    ['sysroot-exnref-ehpic', { WASIXCC_WASM_EXCEPTIONS: 'exnref', WASIXCC_PIC: 'yes', WASIXCC_ASYNCIFY: '0' }],
    ['sysroot-eh', { WASIXCC_WASM_EXCEPTIONS: 'legacy', WASIXCC_PIC: 'no' }],
    ['sysroot-ehpic', { WASIXCC_WASM_EXCEPTIONS: 'legacy', WASIXCC_PIC: 'yes' }],
  ];
  const WANT = 'caught=117107 dtors=2 tl=tls seen=in thread';
  for (const f of ['cxx-eh.cpp', 'cxx-terminate.cpp']) await k.writeFile(`/home/${f}`, readFileSync(join(here, f)));
  const hostEnv = { ...wasixcc(join(work, 'host')), WASIXCC_SYSROOT_PREFIX: hostSys };
  const results = [];
  const check = async (label, wasmPath) => {
    if (arg('--only') !== 'terminate') {
      const tr = await run(['bash', '-c', `${wasmPath}.eh.wasm; echo rc=$?`], { cwd: '/home', env: ccEnv });
      assert.equal(tr.stdout.trim(), `${WANT}\nrc=0`, `${label} cxx-eh: ${tr.stdout}${tr.stderr}`);
    }
    const tt = await run(['bash', '-c', `${wasmPath}.term.wasm; echo rc=$?`], { cwd: '/home', env: ccEnv });
    assert.equal(tt.stdout.trim(), 'throwing\nterminate handler ran\nrc=137', `${label} std::terminate: ${tt.stdout}${tt.stderr}`);
    results.push(label);
  };
  const pick = arg('--variants')?.split(',');
  const W24 = new Set((arg('--wasm-clang') ?? EH.map(([n]) => n).join(',')).split(',').filter(Boolean));
  for (const [v, venv] of EH.filter(([n]) => !pick || pick.includes(n))) {
    const progs = arg('--only') === 'terminate' ? [['cxx-terminate.cpp', 'term']] : [['cxx-eh.cpp', 'eh'], ['cxx-terminate.cpp', 'term']];
    for (const [src, tag] of progs) {
      if (W24.has(v)) {
        const out = `/home/w24-${v}.${tag}.wasm`;
        // wasm-clang 24.0.0-21's driver emits exnref code in every mode; for the legacy trees ask for legacy EH explicitly.
        const legacy = venv.WASIXCC_WASM_EXCEPTIONS === 'legacy' ? ['-mllvm', '--wasm-use-legacy-eh=true', '-Wl,-mllvm,--wasm-use-legacy-eh=true'] : [];
        const r = await run(['c++', '-O2', '-pthread', ...legacy, src, '-o', out], { cwd: '/home', env: { ...ccEnv, ...venv } });
        assert.equal(r.status, 0, `wasm-clang c++ ${src} (${v}): rc=${r.status}\n${r.stdout}${r.stderr}`);
        if (arg('--dump')) writeFileSync(join(resolve(arg('--dump')), `w24-${v}.${tag}.wasm`), Buffer.from(await k.readFile(out)));
      }
      const hout = join(work, `h21-${v}.${tag}.wasm`);
      execFileSync('wasixcc++', ['-O2', '-pthread', join(here, src), '-o', hout], { env: { ...hostEnv, ...venv }, stdio: ['ignore', 'pipe', 'inherit'] });
      await k.writeFile(`/home/h21-${v}.${tag}.wasm`, readFileSync(hout));
      await k.chmod(`/home/h21-${v}.${tag}.wasm`, 0o755);
    }
    if (W24.has(v)) await check(`wasm-clang 24 ${v}`, `/home/w24-${v}`);
    await check(`wasixcc clang 21 ${v}`, `/home/h21-${v}`);
  }
  console.log(`C++ exceptions (${WANT}) and std::terminate through a handler, in ${results.length} builds: ${results.join(', ')}`);
  console.log('PASS test/cxx-eh.mjs');
} catch (e) {
  process.exitCode = 1;
  console.log(`FAIL ${e.stack}`);
} finally {
  if (k) await k.terminate();
  rmSync(work, { recursive: true, force: true });
}
