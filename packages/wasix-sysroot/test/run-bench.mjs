#!/usr/bin/env node
// Create micro-benchmark (homescoop#169): test/bench-create.c built against
// a wasix-sysroot tarball and against a base (default: the published
// 2025.9.30-15, before slicc_fs), run interleaved on slicc-kernel's Node
// entry (cert/meta.json's kernel), medians per case.
//
//   node packages/wasix-sysroot/test/run-bench.mjs --tarball <package.tgz> \
//     [--base <tgz or npm spec>] [--rounds 10] [--n 2000] [--kernel-dir <dir>]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { arg, command, kernel, sysroot, wasixcc } from './harness.mjs';

const args = process.argv.slice(2);
if (!arg(args, '--tarball')) {
  console.error('usage: run-bench.mjs --tarball <package.tgz> [--base <tgz|npm spec>] [--rounds N] [--n N] [--kernel-dir <dir>]');
  process.exit(2);
}
const builds = {
  new: resolve(arg(args, '--tarball')),
  base: arg(args, '--base') ?? '@ai-ecoverse/wasix-sysroot@2025.9.30-15',
};
const rounds = Number(arg(args, '--rounds') ?? 10);
const n = Number(arg(args, '--n') ?? 2000);
const kernelDir = arg(args, '--kernel-dir') && resolve(arg(args, '--kernel-dir'));
const work = mkdtempSync(join(tmpdir(), 'wasix-sysroot-bench-'));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

try {
  const env = wasixcc(work);
  const k = await kernel(work, kernelDir);
  for (const [name, tarball] of Object.entries(builds)) {
    console.log(`== ${name}: ${tarball}`);
    const pkg = join(work, `bench-${name}`);
    command(env, sysroot(tarball, join(work, `sysroot-${name}`)), 'bench-create', pkg, `bench-${name}`);
    await k.install(pkg);
  }
  console.log(`== ${k.label} (Node entry): ${rounds} rounds × ${n}, interleaved`);
  const times = {};
  for (let r = 0; r < rounds; r++) {
    for (const name of r % 2 ? ['base', 'new'] : ['new', 'base']) {
      const dir = `/home/bench-${name}-${r}`;
      await k.run(['mkdir', '-p', dir]);
      const res = await k.run([`bench-${name}`, dir, String(n)], { cwd: dir });
      if (res.status !== 0) throw new Error(`bench-${name} rc=${res.status}: ${res.stderr}`);
      for (const line of res.stdout.trim().split('\n')) {
        const [kase, ms] = line.split(' ');
        ((times[kase] ??= { new: [], base: [] })[name]).push(Number(ms));
      }
      await k.run(['rm', '-rf', dir]);
    }
  }
  console.log('case            base ms   new ms   change');
  for (const [kase, t] of Object.entries(times)) {
    const b = median(t.base);
    const v = median(t.new);
    console.log(`${kase.padEnd(15)} ${b.toFixed(1).padStart(7)}  ${v.toFixed(1).padStart(7)}   ${(((v - b) / b) * 100).toFixed(1).padStart(6)}%`);
  }
  await k.kernel.terminate();
} finally {
  rmSync(work, { recursive: true, force: true });
}
