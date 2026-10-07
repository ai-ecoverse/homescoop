#!/usr/bin/env node
/**
 * Prove a cert/*.mjs fails against a deliberately broken tarball (empty .wasm).
 *
 *   node scripts/browser-cert/prove-negative.mjs --package jq --tarball good.tgz
 *
 * Exit 0 only if the cert run fails (negative proven).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

function flag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : '';
}

const pkgName = flag('--package');
const tarball = resolve(flag('--tarball') || '');
if (!pkgName || !tarball) {
  console.error('usage: prove-negative.mjs --package <name> --tarball <good.tgz>');
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), 'homescoop-neg-'));
const extract = join(work, 'pkg');
mkdirSync(extract, { recursive: true });
spawnSync('tar', ['-xzf', tarball, '-C', extract], { stdio: 'inherit' });
const pkgRoot = join(extract, 'package');
const bin = join(pkgRoot, 'bin');
const wasms = readdirSync(bin).filter((f) => f.endsWith('.wasm'));
if (wasms.length === 0) {
  console.error('prove-negative: no bin/*.wasm to corrupt');
  process.exit(1);
}
for (const w of wasms) writeFileSync(join(bin, w), '');
const bad = join(work, 'bad.tgz');
spawnSync('tar', ['-czf', bad, '-C', extract, 'package'], { stdio: 'inherit' });

const env = { ...process.env };
const r = spawnSync(
  process.execPath,
  [join(here, 'run.mjs'), '--package', pkgName, '--tarball', bad],
  { cwd: root, env, encoding: 'utf8' },
);
console.log(r.stdout);
console.error(r.stderr);
rmSync(work, { recursive: true, force: true });

if (r.status === 0) {
  console.error('prove-negative: cert unexpectedly PASSED on corrupted wasm');
  process.exit(1);
}
console.log(`prove-negative: ok — cert failed on bad ${pkgName} tarball (status ${r.status})`);
process.exit(0);
