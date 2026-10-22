#!/usr/bin/env node
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
  console.error('usage: tools.mjs --tarball <wasm-clang package.tgz | npm spec> [--kernel <npm spec>] [--expect current|old]');
  process.exit(2);
}
const expect = arg('--expect') ?? 'current';
if (!['current', 'old'].includes(expect)) throw new Error('--expect current|old');
const kernelSpec = arg('--kernel') ?? meta.kernel;
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26, ...opts }).toString();
const S = '@ai-ecoverse';
const TREES = ['sysroot-exnref-eh', 'sysroot-exnref-ehpic'];
const WEB_USER_ENV = /USER\s*:\s*["']web_user/;

function unpack(spec, dir, members = []) {
  mkdirSync(dir, { recursive: true });
  let tgz = resolve(spec);
  if (!statSync(tgz, { throwIfNoEntry: false })) {
    tgz = join(dir, sh('npm', ['pack', '--silent', '--pack-destination', dir, spec]).trim().split('\n').pop());
  }
  sh('tar', ['xzf', tgz, '-C', dir, ...members]);
  return join(dir, 'package');
}

const ASM = '\t.globl\tfoo\n\t.type\tfoo,@function\nfoo:\n\t.functype\tfoo () -> (i32)\n\ti32.const\t7\n\tend_function\n';
const ASM_CPP = '#ifndef _WASI_EMULATED_MMAN\n#error no driver defines\n#endif\n' + ASM.replaceAll('foo', 'bar');
const C_SRC = '#ifndef _WASI_EMULATED_MMAN\n#error no driver defines\n#endif\nint baz(void) { return 3; }\n';

const work = mkdtempSync(join(tmpdir(), 'wasm-clang-tools-'));
let k;
const failures = [];
const row = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures.push(name);
};
try {
  const clang = unpack(arg('--tarball'), join(work, 'clang'));
  const cpkg = JSON.parse(readFileSync(join(clang, 'package.json'), 'utf8'));
  const sysVer = cpkg.dependencies?.[`${S}/wasix-sysroot`];
  assert.ok(sysVer, 'wasm-clang package.json pins no wasix-sysroot');
  console.log(`== ${cpkg.name}@${cpkg.version}, wasix-sysroot ${sysVer}, ${kernelSpec}, users enforce, expect ${expect}`);
  const sys = unpack(`${S}/wasix-sysroot@${sysVer}`, join(work, 'sysroot'), ['package/package.json', ...TREES.map((t) => `package/${t}`)]);

  const glue = readFileSync(join(clang, 'bin/llvm'), 'latin1');
  const getEnv = glue.slice(glue.indexOf('getEnvStrings='), glue.indexOf('getEnvStrings=') + 400);
  row('static: getEnvStrings has no web_user placeholders (homescoop#1502)', glue.includes('getEnvStrings=') && !WEB_USER_ENV.test(glue), getEnv.slice(0, 160));
  const loop = glue.match(/nlinks=0;nlinks(<=?)40;/);
  row('static: FS.lookupPath follows 40 symlinks (nlinks<=40, package patch 0014)', loop?.[1] === '<=', loop?.[0] ?? 'no linkloop bound');
  const notices = statSync(join(clang, 'THIRD-PARTY-NOTICES.md'), { throwIfNoEntry: false }) ? readFileSync(join(clang, 'THIRD-PARTY-NOTICES.md'), 'utf8') : '';
  const shimAt = notices.search(/^## homescoop: .*\bslicc shims\b.*Apache-2\.0/m);
  row('static: THIRD-PARTY-NOTICES.md has the slicc shims section with the Apache-2.0 text (homescoop#1535)', shimAt >= 0 && /Apache License\s+Version 2\.0/.test(notices.slice(shimAt)), shimAt >= 0 ? notices.slice(shimAt, shimAt + 80) : 'no shims section');

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
  await copyTree(clang, `/node_modules/${S}/wasm-clang`);
  await copyTree(sys, `/node_modules/${S}/wasix-sysroot`, (p) => p.endsWith('/include/c++'));
  console.log(`== kernel ${kver} (Node entry): ${files} files installed, no wasm-binaryen`);
  const run = (argv, o = {}) => k.run(argv, { cwd: o.cwd || '/home/t', env: o.env || {}, stdin: o.stdin });
  const ccEnv = { TMPDIR: '/tmp' };
  for (let i = 0; ; i++) {
    const r = await run(['cc', '--version'], { cwd: '/', env: ccEnv });
    if (r.status === 0) break;
    if (i >= 100) assert.fail(`cc --version: rc=${r.status} ${r.stdout}${r.stderr}`);
    await new Promise((res) => setTimeout(res, 200));
  }
  assert.equal((await run(['mkdir', '-p', '/home/t'], { cwd: '/' })).status, 0);
  await k.writeFile('/home/t/a.s', ASM);
  await k.writeFile('/home/t/p.S', ASM_CPP);
  await k.writeFile('/home/t/raw.asm', ASM.replaceAll('foo', 'qux'));
  await k.writeFile('/home/t/c.c', C_SRC);

  const tail = (r) => `rc=${r.status} ${`${r.stderr}`.trim().split('\n').slice(-3).join(' | ')}`;
  const syms = async (obj) => (await run(['llvm-nm', obj], { env: ccEnv })).stdout;
  const asmRows = [
    ['cc -Werror -c a.s (homescoop#1408)', ['cc', '-Werror', '-c', 'a.s', '-o', 'a.o'], {}, 'a.o', /T foo/],
    ['cc -Werror -c a.s with WASIXCC_PIC=yes', ['cc', '-Werror', '-c', 'a.s', '-o', 'apic.o'], { WASIXCC_PIC: 'yes' }, 'apic.o', /T foo/],
    ['cc -Werror -x assembler -c raw.asm', ['cc', '-Werror', '-x', 'assembler', '-c', 'raw.asm', '-o', 'raw.o'], {}, 'raw.o', /T qux/],
    ['c++ -Werror -c a.s', ['c++', '-Werror', '-c', 'a.s', '-o', 'axx.o'], {}, 'axx.o', /T foo/],
  ];
  const asmGot = [];
  for (const [name, argv, env, obj, sym] of asmRows) {
    const r = await run(argv, { env: { ...ccEnv, ...env } });
    const ok = r.status === 0 && sym.test(await syms(obj));
    asmGot.push(ok);
    if (expect === 'current') row(name, ok, ok ? '' : tail(r));
    else console.log(`     ${name}: ${tail(r)}`);
  }
  if (expect === 'old') row('negative: cc -Werror -c a.s fails on the driver\'s unused compile flags (homescoop#1408)', !asmGot[0], `${asmGot}`);
  if (expect === 'current') {
    const cpp = await run(['cc', '-Werror', '-c', 'p.S', '-o', 'p.o'], { env: ccEnv });
    row('cc -Werror -c p.S keeps the driver defines', cpp.status === 0 && /T bar/.test(await syms('p.o')), tail(cpp));
    const mixed = await run(['cc', '-Werror', '-c', 'a.s', 'c.c'], { env: ccEnv });
    row('cc -Werror -c a.s c.c keeps the driver defines for c.c', mixed.status === 0 && /T baz/.test(await syms('c.o')) && /T foo/.test(await syms('a.o')), tail(mixed));
    const unused = await run(['cc', '-Werror', '-DUSER_FLAG', '-c', 'a.s', '-o', 'u.o'], { env: ccEnv });
    row('cc -Werror -DUSER_FLAG -c a.s still reports the caller\'s own unused flag', unused.status !== 0 && /unused during compilation: '-D USER_FLAG'/.test(unused.stderr) && !/_WASI_EMULATED/.test(unused.stderr), tail(unused));
  }

  await k.writeFile('/wasm-opt', '#!/bin/sh\nexit 0\n');
  assert.equal((await run(['chmod', '755', '/wasm-opt'], { cwd: '/' })).status, 0);
  assert.equal((await run(['cc', '-c', 'a.s', '-o', 'l.o'], { env: ccEnv })).status, 0);
  const envLink = ['env', '-i', '/usr/bin/clang', '-###', '--target=wasm32-wasip1', '-O2', '-nostdlib', '-Wl,--no-entry', 'l.o', '-o', 'l.wasm'];
  const plan = await run(envLink);
  const plan2 = `${plan.stdout}${plan.stderr}`;
  const usesRootPath = /"\/wasm-opt"/.test(plan2);
  if (expect === 'current') {
    row('env -i clang -O2 link: no PATH=/, so no /wasm-opt from the root (homescoop#1502)', plan.status === 0 && !usesRootPath, plan2.split('\n').filter((l) => /wasm-opt|error/.test(l)).join(' | ') || 'no wasm-opt step');
  } else {
    row('negative: env -i clang -O2 link picks /wasm-opt through Emscripten\'s PATH=/ (homescoop#1502)', usesRootPath, plan2.split('\n').filter((l) => /wasm-opt/.test(l)).join(' | '));
  }

  const chain = async (n) => {
    const dir = `/tmp/l${n}`;
    const r = await run(['bash', '-c', `mkdir -p ${dir} && for i in $(seq 0 ${n - 2}); do ln -s ${dir}/l$((i+1)) ${dir}/l$i; done && ln -s /home/t/c.c ${dir}/l${n - 1}`], { cwd: '/' });
    assert.equal(r.status, 0, `chain ${n}: ${r.stderr}`);
    return `${dir}/l0`;
  };
  const via40 = await chain(40);
  const via41 = await chain(41);
  const s40 = await run(['clang', '--target=wasm32-wasip1', '-D_WASI_EMULATED_MMAN', '-fsyntax-only', '-x', 'c', via40], { env: ccEnv });
  const s41 = await run(['clang', '--target=wasm32-wasip1', '-D_WASI_EMULATED_MMAN', '-fsyntax-only', '-x', 'c', via41], { env: ccEnv });
  if (expect === 'current') {
    row('clang reads a source through 40 symlinks (package patch 0014, homescoop#611)', s40.status === 0, tail(s40));
    row('clang refuses 41 symlinks', s41.status !== 0, tail(s41));
  } else {
    row('negative: clang fails on 40 symlinks (nlinks<40)', s40.status !== 0, tail(s40));
  }

  if (expect === 'old') {
    const old = failures.filter((f) => f.startsWith('static: '));
    failures.splice(0, failures.length, ...failures.filter((f) => !f.startsWith('static: ')));
    assert.equal(old.length, 3, `the old package should fail all three static rows: ${old.join('; ')}`);
  }
  assert.deepEqual(failures, [], `${failures.length} row(s) failed`);
  console.log(expect === 'current'
    ? `PASS ${cpkg.name}@${cpkg.version}: shims notice, slicc-env.js and nlinks<=40 in the glue; .s compiles under -Werror, env -i has no PATH=/, 40 symlinks resolve`
    : `PASS negative: ${cpkg.name}@${cpkg.version} fails the static, .s, env -i and symlink rows`);
} catch (e) {
  process.exitCode = 1;
  console.log(`FAIL ${e.stack}`);
} finally {
  if (k) await k.terminate();
  rmSync(work, { recursive: true, force: true });
}
