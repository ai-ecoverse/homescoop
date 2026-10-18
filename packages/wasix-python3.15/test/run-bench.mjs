#!/usr/bin/env node
// File-create micro-benchmark (homescoop#181): a wasix-python tarball
// against a base (default: the published 3.14.2-11, before slicc_fs modes),
// interleaved on slicc-kernel's Node entry (cert/meta.json's kernel),
// medians per case. Like packages/wasix-sysroot/test/run-bench.mjs, with
// the loop in Python.
//
//   node packages/wasix-python/test/run-bench.mjs --tarball <package.tgz> \
//     [--base <tgz or npm spec>] [--rounds 7] [--n 500]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const meta = JSON.parse(readFileSync(join(here, '../cert/meta.json'), 'utf8'));
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
if (!arg('--tarball')) {
  console.error('usage: run-bench.mjs --tarball <package.tgz> [--base <tgz|npm spec>] [--rounds N] [--n N]');
  process.exit(2);
}
const builds = { new: resolve(arg('--tarball')), base: arg('--base') ?? '@ai-ecoverse/wasix-python@3.14.2-11' };
const rounds = Number(arg('--rounds') ?? 7);
const n = Number(arg('--n') ?? 500);
const work = mkdtempSync(join(tmpdir(), 'wasix-python-bench-'));
const sh = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { stdio: ['ignore', 'pipe', 'inherit'], ...opts }).toString();
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const BENCH = `
import os, sys, time
d, n = sys.argv[1], int(sys.argv[2])
def t(f):
    s = time.perf_counter(); f(); return (time.perf_counter() - s) * 1000
def create():
    for i in range(n):
        with open(f"{d}/c{i}", "w") as fh: fh.write("x")
def excl():
    for i in range(n):
        os.close(os.open(f"{d}/x{i}", os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644))
def chmod():
    for i in range(n): os.chmod(f"{d}/c{i}", 0o600)
def stat():
    for i in range(n): os.stat(f"{d}/c{i}")
def mkdir():
    for i in range(n // 5): os.mkdir(f"{d}/d{i}")
def unlink():
    for i in range(n): os.unlink(f"{d}/c{i}"); os.unlink(f"{d}/x{i}")
for name, f in (("open-w", create), ("open-excl", excl), ("chmod", chmod), ("stat", stat), ("mkdir", mkdir), ("unlink", unlink)):
    print(name, f"{t(f):.1f}")
`;

try {
  const nm = join(work, 'nm');
  sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', meta.kernel, ...meta.needsInstall.slice(0, 2)]);
  const { createNodeKernel } = await import(pathToFileURL(join(nm, 'node_modules/@ai-ecoverse/slicc-kernel/dist/node.js')).href);
  const k = await createNodeKernel({});
  const copyTree = async (src, dest, rewrite) => {
    for (const e of readdirSync(src)) {
      const p = join(src, e);
      if (statSync(p).isDirectory()) await copyTree(p, `${dest}/${e}`, rewrite);
      else await k.writeFile(`${dest}/${e}`, rewrite && e === 'package.json' && dest.split('/').length === 4 ? rewrite(readFileSync(p)) : readFileSync(p));
    }
  };
  for (const need of meta.needs.slice(0, 2)) await copyTree(join(nm, 'node_modules', need), `/node_modules/${need}`);
  for (const [name, tarball] of Object.entries(builds)) {
    const dir = join(work, name);
    sh('mkdir', ['-p', dir]);
    let tgz = tarball;
    try { statSync(tarball); } catch { tgz = join(dir, sh('npm', ['pack', '--silent', '--pack-destination', dir, tarball]).trim().split('\n').pop()); }
    sh('tar', ['xzf', tgz, '-C', dir]);
    // Install as @bench/python-<name> with command python-<name>.
    await copyTree(join(dir, 'package'), `/node_modules/@bench/python-${name}`, (buf) => {
      const pj = JSON.parse(buf.toString());
      pj.name = `@bench/python-${name}`;
      pj.slicc.commands = { [`python-${name}`]: pj.slicc.commands.python };
      return Buffer.from(JSON.stringify(pj));
    });
    console.log(`== ${name}: ${tarball} (${JSON.parse(readFileSync(join(dir, 'package/package.json'))).version})`);
  }
  await k.writeFile('/home/bench.py', Buffer.from(BENCH));
  console.log(`== ${meta.kernel} (Node entry): ${rounds} rounds × ${n} files, interleaved`);
  const times = {};
  for (let r = 0; r < rounds; r++) {
    for (const name of r % 2 ? ['base', 'new'] : ['new', 'base']) {
      const dir = `/home/bench-${name}-${r}`;
      await k.run(['mkdir', '-p', dir], { cwd: '/home', env: {} });
      const res = await k.run([`python-${name}`, '/home/bench.py', dir, String(n)], { cwd: '/home', env: {} });
      if (res.status !== 0) throw new Error(`python-${name} rc=${res.status}: ${res.stderr}`);
      for (const line of res.stdout.trim().split('\n')) {
        const [kase, ms] = line.split(' ');
        ((times[kase] ??= { new: [], base: [] })[name]).push(Number(ms));
      }
      await k.run(['rm', '-rf', dir], { cwd: '/home', env: {} });
    }
  }
  console.log('case          base ms   new ms   change');
  for (const [kase, t] of Object.entries(times)) {
    const b = median(t.base);
    const v = median(t.new);
    console.log(`${kase.padEnd(12)} ${b.toFixed(1).padStart(8)} ${v.toFixed(1).padStart(8)}   ${(((v - b) / b) * 100).toFixed(1).padStart(6)}%`);
  }
  await k.terminate();
} finally {
  rmSync(work, { recursive: true, force: true });
}
