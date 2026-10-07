#!/usr/bin/env node
/**
 * Packaging-only bump: @ai-ecoverse/wasm-coreutils 9.12.0-1 → 9.12.0-2
 * Remove slicc.commands entries that clash with wasm-procps (uptime, kill).
 * Same bin/* bytes as the published -1 tarball (file-by-file / git -9 rule).
 *
 *   node scripts/packaging-only-coreutils-drop-procps-clashes.mjs
 *   → writes .homescoop-out/ai-ecoverse-wasm-coreutils-9.12.0-2.tgz + .sha256
 *
 * Does not publish. Run alongside procps first publish after human cert.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.homescoop-out');
const from = '@ai-ecoverse/wasm-coreutils@9.12.0-1';
const nextVer = '9.12.0-2';
const drop = new Set(['uptime', 'kill']);

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'cu-pack-'));
try {
  const pack = spawnSync('npm', ['pack', from, '--pack-destination', work], {
    encoding: 'utf8',
  });
  if (pack.status !== 0) {
    console.error(pack.stderr || pack.stdout);
    process.exit(1);
  }
  const tgzName = (pack.stdout || '').trim().split('\n').pop();
  const srcTgz = join(work, tgzName);
  const extract = join(work, 'pkg');
  mkdirSync(extract);
  spawnSync('tar', ['-xzf', srcTgz, '-C', extract], { stdio: 'inherit' });
  const pkgPath = join(extract, 'package', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (pkg.version !== '9.12.0-1') {
    console.error(`expected upstream package 9.12.0-1, got ${pkg.version}`);
    process.exit(1);
  }
  for (const name of drop) {
    if (!pkg.slicc?.commands?.[name]) {
      console.error(`missing slicc.commands.${name} on ${from}`);
      process.exit(1);
    }
    delete pkg.slicc.commands[name];
  }
  pkg.version = nextVer;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  const packed = spawnSync('npm', ['pack'], {
    cwd: join(extract, 'package'),
    encoding: 'utf8',
  });
  if (packed.status !== 0) {
    console.error(packed.stderr || packed.stdout);
    process.exit(1);
  }
  const outName = (packed.stdout || '').trim().split('\n').pop();
  const built = join(extract, 'package', outName);
  const dest = join(outDir, `ai-ecoverse-wasm-coreutils-${nextVer}.tgz`);
  copyFileSync(built, dest);
  const sha = createHash('sha256').update(readFileSync(dest)).digest('hex');
  writeFileSync(`${dest}.sha256`, `${sha}  ${dest}\n`);
  console.log(dest);
  console.log(`sha256 ${sha}`);
  console.log(`dropped slicc.commands: ${[...drop].join(', ')}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
