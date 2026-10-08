#!/usr/bin/env node
/**
 * Packaging-only: @ai-ecoverse/wasi-pnpm 12.9.1-4 → 12.9.1-5
 * Add slicc.env.PNPM_WASM_EXECUTABLE=${package}/bin/pnpm.wasm so pnpm add -g
 * can activate global installs without kernel/bios hardcoding the path
 * (slicc-kernel#88 / thr_ej75dimgf5).
 *
 *   node scripts/packaging-only-wasi-pnpm-pnpm-wasm-executable.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.homescoop-out');
const from = '@ai-ecoverse/wasi-pnpm@12.9.1-4';
const nextVer = '12.9.1-5';

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'pnpm-pack-'));
try {
  const pack = spawnSync('npm', ['pack', from, '--pack-destination', work], { encoding: 'utf8' });
  if (pack.status !== 0) {
    console.error(pack.stderr || pack.stdout);
    process.exit(1);
  }
  const tgzName = (pack.stdout || '').trim().split('\n').pop();
  const extract = join(work, 'pkg');
  mkdirSync(extract);
  spawnSync('tar', ['-xzf', join(work, tgzName), '-C', extract], { stdio: 'inherit' });
  const pkgPath = join(extract, 'package', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.version !== '12.9.1-4') {
    console.error(`expected ${from} version 12.9.1-4, got ${pkg.version}`);
    process.exit(1);
  }
  if (pkg.slicc?.env?.PNPM_WASM_EXECUTABLE) {
    console.error('PNPM_WASM_EXECUTABLE already set on source tarball');
    process.exit(1);
  }
  pkg.version = nextVer;
  pkg.slicc.env = {
    PNPM_SLICC_PACKAGE: pkg.slicc.env.PNPM_SLICC_PACKAGE,
    PNPM_WASM_EXECUTABLE: '${package}/bin/pnpm.wasm',
    ...Object.fromEntries(
      Object.entries(pkg.slicc.env).filter(([k]) => k !== 'PNPM_SLICC_PACKAGE'),
    ),
  };
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  copyFileSync(pkgPath, join(root, 'packages/wasi-pnpm/package/package.json'));

  const packed = spawnSync('npm', ['pack'], {
    cwd: join(extract, 'package'),
    encoding: 'utf8',
  });
  if (packed.status !== 0) {
    console.error(packed.stderr || packed.stdout);
    process.exit(1);
  }
  const outName = (packed.stdout || '').trim().split('\n').pop();
  const dest = join(outDir, `ai-ecoverse-wasi-pnpm-${nextVer}.tgz`);
  copyFileSync(join(extract, 'package', outName), dest);
  const sha = createHash('sha256').update(readFileSync(dest)).digest('hex');
  writeFileSync(`${dest}.sha256`, `${sha}  ${dest}\n`);
  console.log(dest);
  console.log(`sha256 ${sha}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
