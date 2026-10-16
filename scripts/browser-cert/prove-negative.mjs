#!/usr/bin/env node
/**
 * Prove a cert/*.mjs fails against a deliberately broken tarball: every
 * WebAssembly module a command runs is emptied.
 *
 *   node scripts/browser-cert/prove-negative.mjs --package jq --tarball good.tgz [run.mjs flags]
 *
 * Emptied: each file a slicc.commands entry names as `wasm`, every bin/*.wasm,
 * and every other file under bin/ that starts with the wasm magic (\0asm).
 * Any other flag (--kernel, --users, --cert, --spec, more --tarball peers)
 * goes to run.mjs as is.
 *
 * Exit 0 only if the cert ran and failed (negative proven).
 */
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);

function startsWithMagic(file) {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(4);
    return readSync(fd, head, 0, 4, 0) === 4 && head.equals(MAGIC);
  } finally {
    closeSync(fd);
  }
}

function filesUnder(dir, rel = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((ent) => {
    const name = rel ? `${rel}/${ent.name}` : ent.name;
    if (ent.isDirectory()) return filesUnder(join(dir, ent.name), name);
    return ent.isFile() ? [name] : [];
  });
}

export function corruptTargets(pkgRoot) {
  const manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
  const targets = new Set();
  const missing = [];
  for (const command of Object.values(manifest.slicc?.commands ?? {})) {
    const wasm = command?.wasm;
    if (typeof wasm !== 'string' || !wasm) continue;
    const rel = wasm.replace(/^\$\{package\}\//, '').replace(/^\.\//, '');
    const file = join(pkgRoot, rel);
    if (existsSync(file) && statSync(file).isFile()) targets.add(rel);
    else missing.push(rel);
  }
  for (const rel of filesUnder(join(pkgRoot, 'bin'), 'bin')) {
    if (rel.endsWith('.wasm') || startsWithMagic(join(pkgRoot, rel))) targets.add(rel);
  }
  return { targets: [...targets].sort(), missing: [...new Set(missing)].sort() };
}

function passThrough(argv) {
  const out = [];
  let tarball = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--package' || a === '--json' || (a === '--tarball' && !tarball)) {
      if (a === '--tarball') tarball = true;
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const at = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] || '' : '';
  };
  const pkgName = at('--package');
  const tarball = at('--tarball') ? resolve(at('--tarball')) : '';
  if (!pkgName || !tarball) {
    console.error('usage: prove-negative.mjs --package <name> --tarball <good.tgz> [run.mjs flags]');
    return 2;
  }
  const work = mkdtempSync(join(tmpdir(), 'homescoop-neg-'));
  try {
    const extract = join(work, 'pkg');
    mkdirSync(extract, { recursive: true });
    const x = spawnSync('tar', ['-xpzf', tarball, '-C', extract], { stdio: 'inherit' });
    const pkgRoot = join(extract, 'package');
    if (x.status !== 0 || !existsSync(join(pkgRoot, 'package.json'))) {
      console.error(`prove-negative: cannot unpack ${tarball}`);
      return 1;
    }
    const { targets, missing } = corruptTargets(pkgRoot);
    for (const rel of missing) console.error(`prove-negative: slicc.commands names ${rel} as wasm, but the tarball has no such file`);
    if (targets.length === 0) {
      console.error('prove-negative: no WebAssembly module to corrupt (no slicc.commands wasm, no bin/*.wasm, nothing under bin/ starting with \\0asm)');
      return 1;
    }
    for (const rel of targets) writeFileSync(join(pkgRoot, rel), '');
    console.log(`prove-negative: emptied ${targets.length} module(s): ${targets.join(', ')}`);
    const bad = join(work, 'bad.tgz');
    const c = spawnSync('tar', ['-czf', bad, '-C', extract, 'package'], { stdio: 'inherit' });
    if (c.status !== 0) {
      console.error('prove-negative: cannot pack the corrupted tarball');
      return 1;
    }
    const json = join(work, 'report.json');
    const r = spawnSync(
      process.execPath,
      [join(here, 'run.mjs'), '--package', pkgName, '--tarball', bad, '--json', json, ...passThrough(argv)],
      { cwd: root, env: process.env, encoding: 'utf8' },
    );
    console.log(r.stdout);
    console.error(r.stderr);
    let report = null;
    try {
      report = JSON.parse(readFileSync(json, 'utf8'));
    } catch {}
    if (r.status === 0) {
      console.error('prove-negative: cert unexpectedly PASSED on corrupted wasm');
      return 1;
    }
    const failed = (report?.specs || []).filter((s) => s.status === 'fail');
    if (!failed.length) {
      console.error(
        `prove-negative: the cert did not get to run a spec (${report?.error || `run.mjs exited ${r.status ?? r.signal} without a report`}); nothing is proven`,
      );
      return 1;
    }
    console.log(
      `prove-negative: ok — cert failed on bad ${pkgName} tarball (status ${r.status}; ${failed.length} of ${report.specs.length} spec(s) failed: ${failed.map((s) => s.spec).join(', ')})`,
    );
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exit(main());
