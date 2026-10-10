#!/usr/bin/env node
// homescoop#169 cert for a wasix-sysroot tarball (cert/meta.json harness
// host-node): build test/modes.c against it with the pinned wasixcc, then
// run test/modes.mjs on slicc-kernel's Node entry at cert/meta.json's kernel.
//
//   node packages/wasix-sysroot/test/run-modes.mjs --tarball .homescoop-out/package.tgz
//
// --kernel-dir <dir> uses a local slicc-kernel build (its dist/node.js)
// instead of meta.kernel, e.g. to try one before it is released. With
// meta "slicc_fs": true the spec requires the kernel's slicc_fs imports.
//
// The sysroot is 160 MB, too big to install into a browser-cert page; the
// program under test is the small modes.wasm linked against it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const args = process.argv.slice(2);
const tarball = resolve(args[args.indexOf('--tarball') + 1] || '');
if (!args.includes('--tarball') || !statSync(tarball, { throwIfNoEntry: false })) {
  console.error('usage: run-modes.mjs --tarball <wasix-sysroot package.tgz>');
  process.exit(2);
}
const kernelDir = args.includes('--kernel-dir') ? resolve(args[args.indexOf('--kernel-dir') + 1]) : null;
const meta = JSON.parse(readFileSync(join(here, '../cert/meta.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'wasix-sysroot-modes-'));
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString();

try {
  console.log(`== sysroot ${tarball}`);
  sh('tar', ['xzf', tarball, '-C', work]);
  const prefix = join(work, 'package');
  for (const v of readdirSync(prefix).filter((d) => d.startsWith('sysroot'))) {
    // wasixcc links from lib/wasm32-wasi; the package ships wasm32-wasip1 only.
    symlinkSync('wasm32-wasip1', join(prefix, v, 'lib/wasm32-wasi'));
  }

  console.log('== modes.wasm (pinned wasixcc)');
  const env = { ...process.env };
  for (const line of sh('bash', [join(root, 'scripts/install-wasixcc.sh'), join(work, 'wasixcc')]).split('\n')) {
    const m = line.match(/^export ([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/\$PATH/, env.PATH);
  }
  env.WASIXCC_SYSROOT_PREFIX = prefix;
  const pkg = join(work, 'modes-pkg');
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  sh('wasixcc', ['-O2', join(here, 'modes.c'), '-o', join(pkg, 'bin/modes.wasm')], { env });
  writeFileSync(
    join(pkg, 'package.json'),
    JSON.stringify({ name: 'wasix-sysroot-modes-test', version: '0.0.0', slicc: { abi: 'wasi', commands: { modes: { wasm: 'bin/modes.wasm' } } } }),
  );

  console.log(`== ${kernelDir ?? meta.kernel} (Node entry)`);
  const nm = join(work, 'nm');
  mkdirSync(nm);
  sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', ...(kernelDir ? [] : [meta.kernel]), ...(meta.needsInstall || meta.needs)]);
  const kernelRoot = kernelDir ?? join(nm, 'node_modules/@ai-ecoverse/slicc-kernel');
  const { createNodeKernel } = await import(pathToFileURL(join(kernelRoot, 'dist/node.js')).href);
  const kernel = await createNodeKernel({});
  const copyTree = async (src, dest) => {
    for (const e of readdirSync(src)) {
      const p = join(src, e);
      if (statSync(p).isDirectory()) await copyTree(p, `${dest}/${e}`);
      else await kernel.writeFile(`${dest}/${e}`, readFileSync(p));
    }
  };
  for (const need of meta.needs) await copyTree(join(nm, 'node_modules', need), `/node_modules/${need}`);
  await copyTree(pkg, '/node_modules/wasix-sysroot-modes-test');
  const ctx = { assert, requireNative: meta.slicc_fs === true, run: (argv, o = {}) => kernel.run(argv, { cwd: o.cwd || '/home', env: o.env || {}, stdin: o.stdin }) };
  let rc = 0;
  try {
    await (await import(pathToFileURL(join(here, 'modes.mjs')).href)).default(ctx);
    console.log('PASS test/modes.mjs');
  } catch (e) {
    rc = 1;
    console.log(`FAIL test/modes.mjs\n${e.stack}`);
  }
  await kernel.terminate();
  process.exitCode = rc;
} finally {
  rmSync(work, { recursive: true, force: true });
}
