#!/usr/bin/env node
// CI cert for a wasm-clang tarball (cert/meta.json harness host-node): the
// clang under test compiles C probes *inside* slicc-kernel's Node entry, with
// the wasix-sysroot it depends on, and the programs run there under
// `users: 'enforce'`.
//
//   node packages/wasm-clang/test/run-cc.mjs --tarball .homescoop-out/package.tgz
//   node packages/wasm-clang/test/run-cc.mjs --tarball .homescoop-out/package.tgz --layout pnpm
//   node packages/wasm-clang/test/run-cc.mjs --tarball @ai-ecoverse/wasm-clang@24.0.0-11 --expect old
//
// The probes are wasix-sysroot's test/r18.c (select / TZ / chdir /
// socketpair / sigaction), r21.c (per-fd termios in a pty), r24.c (chown /
// lchown / fchown / fchownat and stat owners as root and as cone) and
// r24link.c (linkat with AT_FDCWD), r26.c (an empty path is ENOENT) and r27.c
// (utimensat NULL/NOW/OMIT, CPU times), checked by the same test/*.mjs specs as
// the sysroot's own cert, plus the slicc.libc marker the sysroot's crt1
// leaves in every program (-22+). They are built with the package's own
// `wasixcc` script (bin/cc: clang + wasm-ld from bin/llvm.wasm) run by
// wasm-bash in the kernel, with no WASIXCC_SYSROOT_PREFIX / CLANG_RESOURCE_DIR
// of our own: the package's slicc.env finds the sysroot. That is the one the
// tarball's package.json pins (its sysroot-exnref-eh, the driver's default,
// without C++ headers), installed where a package manager puts it (--layout):
//   flat   /node_modules/@ai-ecoverse/{wasm-clang,wasix-sysroot} (npm);
//   pnpm   one `pnpm add -g` project under PNPM_HOME: the two packages side by
//          side in .pnpm/@ai-ecoverse+wasm-clang@<v>/node_modules/@ai-ecoverse/,
//          the project's node_modules/@ai-ecoverse/wasm-clang a symlink there;
//   shared the sysroot at /shared/lib/node_modules/@ai-ecoverse/wasix-sysroot
//          (what 24.0.0-11's slicc.env hard-coded).
//
// The glue runs as shipped (homescoop#276, 24.0.0-15). slicc-emscripten
// appends a Node-host runner to bin/llvm (and its byte-copies bin/clang,
// bin/wasm-ld, …) that runs main with process.argv as soon as the runtime is
// up whenever `process` exists, which is also true inside slicc-kernel's Node
// process worker: main ran with no arguments, exited the runtime, and the
// kernel's own callMain trapped. From 24.0.0-15 the runner stays out of a
// host that sets noInitialRun, as the kernel does (glue-node-runner.patch);
// the cert requires that guard on every glue of the package under test and
// runs clang, wasm-ld and llvm-nm --version through it. Older glues (--expect
// old, and wasm-binaryen's until it ships the guard) are still cut off before
// the runner ("// Node runs the tool immediately" to the end) in the cert's
// copy only, as before.
//
// The cc driver's Asyncify check (homescoop#451): the realm has no grep (the
// cert installs none); each probe that imports wasix_32v1.proc_fork,
// stack_checkpoint or stack_restore must come out asyncified, and the others
// must not.
//
// --expect old is the negative: a clang pinned to a pre -20 sysroot (24.0.0-11
// → -17) builds r24, and as root under users enforce its chown to a real id
// is ENOSYS (the old libc never calls the kernel), with no slicc.libc marker.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ptySession } from '../../../scripts/browser-cert/context.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const probes = resolve(here, '../../wasix-sysroot/test');
const meta = JSON.parse(readFileSync(join(here, '../cert/meta.json'), 'utf8'));
const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!arg('--tarball')) {
  console.error('usage: run-cc.mjs --tarball <wasm-clang package.tgz | npm spec> [--expect current|old] [--kernel <npm spec>] [--probes r18,r21,…]');
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
  const sys = unpack(`${S}/wasix-sysroot@${sysVer}`, join(work, 'sysroot'), ['package/package.json', `package/${VARIANT}`]);
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
  const noCxx = (p) => p.endsWith('/include/c++');
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
  const all = ['r18', 'r21', 'r24', 'r24link', 'r26', 'r27', 'r28', 'r28w'];
  const names = expect === 'old' ? ['r24'] : (arg('--probes')?.split(',') ?? all);
  for (const n of names) assert.ok(all.includes(n), `--probes: unknown probe ${n}`);
  assert.equal((await run(['mkdir', '-p', '/home/cc', `${PROBES_AT}/bin`])).status, 0);
  for (const n of names) {
    await k.writeFile(`/home/cc/${n}.c`, readFileSync(join(probes, `${n}.c`)));
    const t = Date.now();
    const r = await run(['wasixcc', '-O2', `${n}.c`, '-o', `${PROBES_AT}/bin/${n}.wasm`], { cwd: '/home/cc', env: ccEnv });
    assert.equal(r.status, 0, `wasixcc ${n}.c: rc=${r.status}\n${r.stdout}${r.stderr}`);
    const wasm = Buffer.from(await k.readFile(`${PROBES_AT}/bin/${n}.wasm`));
    const marker = libcMarker(wasm);
    const mod = new WebAssembly.Module(wasm);
    const asyncified = WebAssembly.Module.exports(mod).some((e) => e.name === 'asyncify_start_unwind');
    const forks = WebAssembly.Module.imports(mod).some((i) => i.module === 'wasix_32v1' && FORK_IMPORTS.includes(i.name));
    console.log(`== ${n}.wasm: ${wasm.length} bytes in ${((Date.now() - t) / 1000).toFixed(1)} s, slicc.libc ${JSON.stringify(marker ?? null)}, fork imports ${forks ? 'yes' : 'no'}, asyncify ${asyncified ? 'yes' : 'no'}`);
    if (expect === 'current') assert.equal(asyncified, forks, `${n}.wasm: cc must asyncify exactly the modules that import ${FORK_IMPORTS.join('/')} (homescoop#451)`);
    if (expect === 'current') assert.equal(marker, `wasix-sysroot ${sysVer}`, `${n}.wasm slicc.libc marker`);
    else assert.equal(marker, undefined, `${n}.wasm: a pre -22 libc has no slicc.libc marker`);
  }
  if (expect === 'current' && names.includes('r28') && binaryen) {
    // homescoop#692: a link without -o (a.out) and the joined -oFILE get the
    // same Asyncify step as -o FILE; WASIXCC_ASYNCIFY=0 skips it.
    const variants = [
      [['-O2', 'r28.c'], 'a.out', true, {}],
      [['-O2', 'r28.c', '-or28j.wasm'], 'r28j.wasm', true, {}],
      // clang passes its own -o after -Wl,-o,FILE, so the program is a.out.
      [['-O2', 'r28.c', '-Wl,-o,r28l.wasm'], 'a.out', true, {}],
      // -Xlinker -o is the linker's, not the program's (homescoop#722).
      [['-O2', 'r28.c', '-Xlinker', '-o', '-Xlinker', 'xl.wasm'], 'a.out', true, {}],
      [['-O2', 'r28.c', '-o', 'r28n.wasm'], 'r28n.wasm', false, { WASIXCC_ASYNCIFY: '0' }],
    ];
    for (const [argv, file, want, env] of variants) {
      const r = await run(['wasixcc', ...argv], { cwd: '/home/cc', env: { ...ccEnv, ...env } });
      assert.equal(r.status, 0, `wasixcc ${argv.join(' ')}: rc=${r.status}\n${r.stdout}${r.stderr}`);
      const mod = new WebAssembly.Module(Buffer.from(await k.readFile(`/home/cc/${file}`)));
      const got = WebAssembly.Module.exports(mod).some((e) => e.name === 'asyncify_start_unwind');
      assert.equal(got, want, `wasixcc ${argv.join(' ')}${env.WASIXCC_ASYNCIFY ? ` (WASIXCC_ASYNCIFY=${env.WASIXCC_ASYNCIFY})` : ''} → ${file}: asyncify ${got ? 'yes' : 'no'}`);
    }
    // Calls that write no program leave an a.out beside them alone, the
    // asyncified one and a non-wasm one (homescoop#710, #711).
    await k.writeFile('/home/cc/x.h', '#define X 1\n');
    const aout = async () => {
      try {
        return createHash('sha256').update(Buffer.from(await k.readFile('/home/cc/a.out'))).digest('hex');
      } catch {
        return 'missing';
      }
    };
    // A response file whose -o the program goes to (homescoop#721), a PCH
    // (#722) and -v with an option value (#711).
    await k.writeFile('/home/cc/args.rsp', 'r28.c -o r28r.wasm\n');
    const nonLinks = [['--version'], ['-v'], ['-v', '-B', '/tmp'], ['-fsyntax-only', 'r18.c'], ['-###', 'r18.c'], ['x.h'],
      ['-x', 'c-header', 'x.h', '-o', 'x.pch'], ['-O2', '@args.rsp']];
    for (const content of [undefined, '#!/bin/sh\necho not wasm\n']) {
      if (content) await k.writeFile('/home/cc/a.out', content);
      const before = await aout();
      for (const argv of nonLinks) {
        const r = await run(['wasixcc', ...argv], { cwd: '/home/cc', env: ccEnv });
        assert.equal(r.status, 0, `wasixcc ${argv.join(' ')} next to ${content ? 'a non-wasm' : 'an asyncified'} a.out: rc=${r.status}\n${r.stdout}${r.stderr}`);
        assert.equal(await aout(), before, `wasixcc ${argv.join(' ')} changed or removed the ${content ? 'non-wasm' : 'asyncified'} a.out beside it`);
      }
    }
    const rsp = new WebAssembly.Module(Buffer.from(await k.readFile('/home/cc/r28r.wasm')));
    assert.ok(WebAssembly.Module.exports(rsp).some((e) => e.name === 'asyncify_start_unwind'), 'wasixcc -O2 @args.rsp (r28.c -o r28r.wasm): r28r.wasm is not asyncified');
    const pch = await run(['bash', '-c', 'test -s x.pch && { test -x x.pch && echo executable || echo plain; }'], { cwd: '/home/cc' });
    assert.equal(pch.stdout, 'plain\n', `x.pch: ${pch.stdout}${pch.stderr}`);
    console.log(`== r28 as a.out (also with -Wl,-o or -Xlinker -o, which clang's own -o overrides), with -or28j.wasm and from @args.rsp: asyncified; x.pch left plain; WASIXCC_ASYNCIFY=0: not; ${nonLinks.map((a) => a.join(' ')).join(', ')} leave an asyncified and a non-wasm a.out alone`);
  }
  await k.writeFile(`${PROBES_AT}/package.json`, JSON.stringify({
    name: 'wasm-clang-cc-probes',
    version: '0.0.0',
    slicc: { abi: 'wasi', commands: Object.fromEntries(names.map((n) => [n, { wasm: `bin/${n}.wasm` }])) },
  }));

  const ctx = { assert, requireNative: true, run, kernel: k, pty: (argv, o) => ptySession(k, argv, o), kernelVersion: kver, variant: 'default' };
  if (expect === 'current') {
    for (const n of names) {
      const spec = await import(pathToFileURL(join(probes, `${n}.mjs`)).href);
      await spec.default(ctx);
      console.log(`PASS ${n} (compiled in the kernel by ${cpkg.name}@${cpkg.version})`);
    }
  } else {
    // Negative: the old libc's chown never reaches the kernel's owners.
    const r = await run(['r24', 'root'], { cwd: '/tmp' });
    assert.equal(r.status, 0, `r24 root: rc=${r.status} ${r.stdout}${r.stderr}`);
    const lines = r.stdout.trim().split('\n');
    console.log(lines.map((l) => `   ${l}`).join('\n'));
    assert.ok(lines.some((l) => l.startsWith('chown: -1 ENOSYS')), `expected chown ENOSYS from a pre -20 libc:\n${r.stdout}`);
    console.log(`PASS negative: ${cpkg.name}@${cpkg.version} (wasix-sysroot ${sysVer}) chown → ENOSYS under users enforce`);
  }
} catch (e) {
  process.exitCode = 1;
  console.log(`FAIL ${e.stack}`);
} finally {
  if (k) await k.terminate();
  rmSync(work, { recursive: true, force: true });
}
