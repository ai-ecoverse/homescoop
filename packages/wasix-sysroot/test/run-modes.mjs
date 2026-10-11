#!/usr/bin/env node
// homescoop#169 cert for a wasix-sysroot tarball (cert/meta.json harness
// host-node): build test/modes.c against it with the pinned wasixcc, then
// run test/modes.mjs on slicc-kernel's Node entry at cert/meta.json's kernel.
//
//   node packages/wasix-sysroot/test/run-modes.mjs --tarball .homescoop-out/package.tgz [--probe r18]
//
// --probe NAME runs test/NAME.c / test/NAME.mjs instead (default: modes);
// r18 is -18's select / chdir / TZ / socketpair probe, r19 is -19's
// raise / alarm / setitimer / nanosleep probe, r20 is -20's credentials
// probe (needs slicc-kernel K1: kernel.users, run({ user })), and tzname is
// -20's strftime('%Z') probe; r21 is -21's terminal probe (slicc_tty); r22
// checks -22's slicc.libc marker in the linked program (ctx.wasm) and getitimer.
//
// --kernel-dir <dir> uses a local slicc-kernel build (its dist/node.js)
// instead of meta.kernel, e.g. to try one before it is released. With
// meta "slicc_fs": true the spec requires the kernel's slicc_fs imports;
// --allow-absent checks the degraded path on a kernel without them.
//
// The sysroot is 160 MB, too big to install into a browser-cert page; the
// program under test is the small modes.wasm linked against it.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { arg, command, here, kernel, meta, sysroot, wasixcc } from './harness.mjs';
import { ptySession } from '../../../scripts/browser-cert/context.mjs';

const args = process.argv.slice(2);
if (!arg(args, '--tarball')) {
  console.error('usage: run-modes.mjs --tarball <wasix-sysroot package.tgz> [--probe NAME] [--variant ehpic] [--kernel-dir <dir>] [--allow-absent]');
  process.exit(2);
}
const tarball = resolve(arg(args, '--tarball'));
const probe = arg(args, '--probe') ?? 'modes';
// --variant ehpic builds the probe against sysroot-ehpic (legacy EH, PIC:
// what wasix-python links) instead of wasixcc's default.
const VARIANTS = { default: {}, ehpic: { WASIXCC_WASM_EXCEPTIONS: 'legacy', WASIXCC_PIC: 'yes' } };
const variant = arg(args, '--variant') ?? 'default';
if (!VARIANTS[variant]) throw new Error(`--variant: one of ${Object.keys(VARIANTS).join(', ')}`);
const kernelDir = arg(args, '--kernel-dir') && resolve(arg(args, '--kernel-dir'));
const work = mkdtempSync(join(tmpdir(), 'wasix-sysroot-modes-'));

try {
  console.log(`== sysroot ${tarball}`);
  const prefix = sysroot(tarball, join(work, 'sysroot'));
  console.log(`== ${probe}.wasm (pinned wasixcc, ${variant} variant)`);
  const pkg = join(work, `${probe}-pkg`);
  command({ ...wasixcc(work), ...VARIANTS[variant] }, prefix, probe, pkg, probe);
  const k = await kernel(work, kernelDir);
  console.log(`== ${k.label} (Node entry)`);
  await k.install(pkg);
  const ctx = { assert, requireNative: meta.slicc_fs === true && !args.includes('--allow-absent'), run: k.run, kernel: k.kernel, pty: (argv, o) => ptySession(k.kernel, argv, o), wasm: join(pkg, `bin/${probe}.wasm`), kernelVersion: k.version };
  try {
    await (await import(pathToFileURL(join(here, `${probe}.mjs`)).href)).default(ctx);
    console.log(`PASS test/${probe}.mjs`);
  } catch (e) {
    process.exitCode = 1;
    console.log(`FAIL test/${probe}.mjs\n${e.stack}`);
  }
  await k.kernel.terminate();
} finally {
  rmSync(work, { recursive: true, force: true });
}
