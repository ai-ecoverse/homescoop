#!/usr/bin/env node
// Cert for a WASIX dev package (cert/meta.json harness host-node): link each
// probe in meta.probes against the package tarball in both flavours with the
// pinned wasixcc, then run cert/*.mjs on slicc-kernel's Node entry.
//
//   node scripts/wasix-lib-cert.mjs <package> --tarball <package.tgz> [--kernel-dir <dir>]
//
// meta.probes: [{ "name": "zprobe", "src": "test/zprobe.c", "libs": ["-lz"] }]
// gives the commands `zprobe` (static-main, lib/) and `zprobe-pic`
// (dynamic-main, lib-pic/). --kernel-dir uses a local slicc-kernel build.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const name = args[0];
if (!name || !opt('--tarball')) {
  console.error('usage: wasix-lib-cert.mjs <package> --tarball <package.tgz> [--kernel-dir <dir>]');
  process.exit(2);
}
const pkgDir = join(root, 'packages', name);
const meta = JSON.parse(readFileSync(join(pkgDir, 'cert/meta.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), `${name}-cert-`));
const sh = (cmd, argv, o = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], ...o }).toString();
const FLAVOURS = {
  // static-main on the asyncify sysroot (perl, ruby)
  '': { lib: 'lib', env: { WASIXCC_PIC: 'no', WASIXCC_WASM_EXCEPTIONS: 'no', WASIXCC_MODULE_KIND: 'static-main' } },
  // dynamic-main, PIC (python)
  '-pic': { lib: 'lib-pic', env: { WASIXCC_PIC: 'yes', WASIXCC_WASM_EXCEPTIONS: 'legacy', WASIXCC_MODULE_KIND: 'dynamic-main' } },
};

try {
  console.log(`== ${name}: ${resolve(opt('--tarball'))}`);
  sh('tar', ['xzf', resolve(opt('--tarball')), '-C', work]);
  const pkg = join(work, 'package');

  const env = { ...process.env, WASIXCC_RUN_WASM_OPT: 'no' };
  for (const line of sh('bash', [join(root, 'scripts/install-wasixcc.sh'), join(work, 'wasixcc')]).split('\n')) {
    const m = line.match(/^export ([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/\$PATH/, env.PATH);
  }
  const probes = join(work, 'probes');
  mkdirSync(join(probes, 'bin'), { recursive: true });
  const commands = {};
  for (const p of meta.probes) {
    for (const [suffix, f] of Object.entries(FLAVOURS)) {
      const cmd = `${p.name}${suffix}`;
      console.log(`== link ${cmd} (${f.env.WASIXCC_MODULE_KIND}, ${f.lib}/)`);
      sh('wasixcc', ['-O2', join(pkgDir, p.src), `-I${join(pkg, 'include')}`, `-L${join(pkg, f.lib)}`, ...p.libs, '-o', join(probes, `bin/${cmd}.wasm`)], {
        env: { ...env, ...f.env },
      });
      commands[cmd] = { wasm: `bin/${cmd}.wasm` };
    }
  }
  writeFileSync(join(probes, 'package.json'), JSON.stringify({ name: `${name}-probes`, version: '0.0.0', slicc: { abi: 'wasi', commands } }));

  const nm = join(work, 'nm');
  mkdirSync(nm);
  const kernelDir = opt('--kernel-dir') && resolve(opt('--kernel-dir'));
  sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', ...(kernelDir ? [] : [meta.kernel]), ...(meta.needsInstall || meta.needs)]);
  const kernelRoot = kernelDir ?? join(nm, 'node_modules/@ai-ecoverse/slicc-kernel');
  console.log(`== ${kernelDir ?? meta.kernel} (Node entry)`);
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
  await copyTree(probes, `/node_modules/${name}-probes`);
  const ctx = { assert, run: (argv, o = {}) => kernel.run(argv, { cwd: o.cwd || '/home', env: o.env || {}, stdin: o.stdin }) };
  for (const spec of readdirSync(join(pkgDir, 'cert')).filter((f) => f.endsWith('.mjs')).sort()) {
    try {
      await (await import(pathToFileURL(join(pkgDir, 'cert', spec)).href)).default(ctx);
      console.log(`PASS cert/${spec}`);
    } catch (e) {
      process.exitCode = 1;
      console.log(`FAIL cert/${spec}\n${e.stack}`);
    }
  }
  await kernel.terminate();
} finally {
  rmSync(work, { recursive: true, force: true });
}
