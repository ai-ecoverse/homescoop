#!/usr/bin/env node
// CI cert for a wasm-clang tarball (cert/meta.json harness host-node): the
// clang under test compiles C probes *inside* slicc-kernel's Node entry, with
// the wasix-sysroot it depends on, and the programs run there under
// `users: 'enforce'`.
//
//   node packages/wasm-clang/test/run-cc.mjs --tarball .homescoop-out/package.tgz
//   node packages/wasm-clang/test/run-cc.mjs --tarball @ai-ecoverse/wasm-clang@24.0.0-11 --expect old
//
// The probes are wasix-sysroot's test/r18.c (select / TZ / chdir /
// socketpair / sigaction), r21.c (per-fd termios in a pty), r24.c (chown /
// lchown / fchown / fchownat and stat owners as root and as cone) and
// r24link.c (linkat with AT_FDCWD), checked by the same test/*.mjs specs as
// the sysroot's own cert, plus the slicc.libc marker the sysroot's crt1
// leaves in every program (-22+). They are built with the package's own
// `wasixcc` script (bin/cc: clang + wasm-ld from bin/llvm.wasm) run by
// wasm-bash in the kernel; the sysroot is the one the tarball's package.json
// pins (its sysroot-exnref-eh, the driver's default, without C++ headers),
// at /shared/lib/node_modules/@ai-ecoverse/wasix-sysroot as in slicc.
//
// --expect old is the negative: a clang pinned to a pre -20 sysroot (24.0.0-11
// → -17) builds r24, and as root under users enforce its chown to a real id
// is ENOSYS (the old libc never calls the kernel), with no slicc.libc marker.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
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
  console.error('usage: run-cc.mjs --tarball <wasm-clang package.tgz | npm spec> [--expect current|old] [--kernel <npm spec>]');
  process.exit(2);
}
const expect = arg('--expect') ?? 'current';
if (!['current', 'old'].includes(expect)) throw new Error('--expect current|old');
const kernelSpec = arg('--kernel') ?? meta.kernel;
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString();
const S = '@ai-ecoverse';
const SYSROOT_AT = `/shared/lib/node_modules/${S}/wasix-sysroot`;
const CLANG_AT = `/node_modules/${S}/wasm-clang`;
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
  const sysVer = cpkg.dependencies?.[`${S}/wasix-sysroot`];
  assert.ok(sysVer, 'wasm-clang package.json has no @ai-ecoverse/wasix-sysroot dependency');
  console.log(`== ${cpkg.name}@${cpkg.version}, wasix-sysroot ${sysVer}, ${kernelSpec}, users enforce, expect ${expect}`);
  const sys = unpack(`${S}/wasix-sysroot@${sysVer}`, join(work, 'sysroot'), ['package/package.json', `package/${VARIANT}`]);

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
  await copyTree(sys, SYSROOT_AT, (p) => p.endsWith('/include/c++'));
  await copyTree(clang, CLANG_AT);
  console.log(`== kernel ${kver} (Node entry): ${files} files installed`);

  const run = (argv, o = {}) => k.run(argv, { cwd: o.cwd || '/home', env: o.env || {}, stdin: o.stdin, ...(o.user !== undefined && { user: o.user }) });
  const ccEnv = { WASIXCC_SYSROOT_PREFIX: SYSROOT_AT, CLANG_RESOURCE_DIR: `${CLANG_AT}/lib/clang/24`, TMPDIR: '/tmp' };
  const names = expect === 'old' ? ['r24'] : ['r18', 'r21', 'r24', 'r24link'];
  assert.equal((await run(['mkdir', '-p', '/home/cc', `${PROBES_AT}/bin`])).status, 0);
  for (const n of names) {
    await k.writeFile(`/home/cc/${n}.c`, readFileSync(join(probes, `${n}.c`)));
    const t = Date.now();
    const r = await run(['wasixcc', '-O2', `${n}.c`, '-o', `${PROBES_AT}/bin/${n}.wasm`], { cwd: '/home/cc', env: ccEnv });
    assert.equal(r.status, 0, `wasixcc ${n}.c: rc=${r.status}\n${r.stdout}${r.stderr}`);
    const wasm = Buffer.from(await k.readFile(`${PROBES_AT}/bin/${n}.wasm`));
    const marker = libcMarker(wasm);
    console.log(`== ${n}.wasm: ${wasm.length} bytes in ${((Date.now() - t) / 1000).toFixed(1)} s, slicc.libc ${JSON.stringify(marker ?? null)}`);
    if (expect === 'current') assert.equal(marker, `wasix-sysroot ${sysVer}`, `${n}.wasm slicc.libc marker`);
    else assert.equal(marker, undefined, `${n}.wasm: a pre -22 libc has no slicc.libc marker`);
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
