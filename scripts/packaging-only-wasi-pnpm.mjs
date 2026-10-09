#!/usr/bin/env node
/**
 * Packaging-only bump of @ai-ecoverse/wasi-pnpm (homescoop#89):
 * the published 12.9.1-7 tarball with the repo's package metadata, README,
 * host/ (pnpm run through the kernel sh) and shims/ (npm, npx, i) on top, as
 * the repo's version. bin/pnpm.wasm, LICENSE and THIRD-PARTY-NOTICES.md stay the
 * published bytes: no new pnpm.wasm build.
 *
 *   node scripts/packaging-only-wasi-pnpm.mjs [outdir]
 *   → <outdir>/package.tgz + package.tgz.sha256 (default .homescoop-out/wasi-pnpm)
 *
 * Does not publish.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoPkg = join(root, 'packages/wasi-pnpm/package');
const from = '@ai-ecoverse/wasi-pnpm@12.9.1-7';
const want = JSON.parse(readFileSync(join(repoPkg, 'package.json'), 'utf8')).version;
const outDir = resolve(process.argv[2] || join(root, '.homescoop-out/wasi-pnpm'));

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || `${cmd} failed`);
    process.exit(1);
  }
  return (r.stdout || '').trim();
};

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'wasi-pnpm-pack-'));
try {
  const srcTgz = join(work, run('npm', ['pack', from, '--pack-destination', work]).split('\n').pop());
  const pkgDir = join(work, 'package');
  run('tar', ['-xzf', srcTgz, '-C', work]);
  const published = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  if (published.version !== '12.9.1-7') {
    console.error(`expected ${from}, got ${published.version}`);
    process.exit(1);
  }
  const wasmBefore = sha256(join(pkgDir, 'bin/pnpm.wasm'));

  copyFileSync(join(repoPkg, 'package.json'), join(pkgDir, 'package.json'));
  copyFileSync(join(repoPkg, 'README.md'), join(pkgDir, 'README.md'));
  for (const dir of ['host', 'shims']) {
    rmSync(join(pkgDir, dir), { recursive: true, force: true });
    cpSync(join(repoPkg, dir), join(pkgDir, dir), { recursive: true });
  }

  if (sha256(join(pkgDir, 'bin/pnpm.wasm')) !== wasmBefore) {
    console.error('bin/pnpm.wasm changed');
    process.exit(1);
  }
  const built = join(pkgDir, run('npm', ['pack'], { cwd: pkgDir }).split('\n').pop());
  const dest = join(outDir, 'package.tgz');
  copyFileSync(built, dest);
  const version = run(process.execPath, [join(root, 'scripts/sync-package-version.mjs'), '--assert-tarball', dest]);
  if (version !== want) {
    console.error(`packed ${version}, expected ${want}`);
    process.exit(1);
  }
  const sha = sha256(dest);
  writeFileSync(`${dest}.sha256`, `${sha}  package.tgz\n`);
  console.log(dest);
  console.log(`@ai-ecoverse/wasi-pnpm@${version} sha256 ${sha}`);
  console.log(`bin/pnpm.wasm sha256 ${wasmBefore} (unchanged from ${from})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
