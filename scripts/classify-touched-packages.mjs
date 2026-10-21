#!/usr/bin/env node
/**
 * Classify touched packages by recipe.builder for CI matrices.
 *
 *   node scripts/classify-touched-packages.mjs --base A --head B
 *   node scripts/classify-touched-packages.mjs --all   (every recipe, as if all were touched)
 *   → JSON { host: string[], slicc: string[], all: string[] }
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let base, head;
const every = args.includes('--all');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') base = args[++i];
  else if (args[i] === '--head') head = args[++i];
}
if (!every && (!base || !head)) {
  console.error('usage: classify-touched-packages.mjs --base <ref> --head <ref> | --all');
  process.exit(2);
}

/** @type {string[]} */
let all;
if (every) {
  all = readdirSync(join(root, 'packages'))
    .filter((p) => existsSync(join(root, 'packages', p, 'recipe.yaml')))
    .sort();
} else {
  const listed = spawnSync(
    'node',
    [join(root, 'scripts/list-touched-packages.mjs'), '--base', base, '--head', head, '--json'],
    { encoding: 'utf8', cwd: root }
  );
  if (listed.status !== 0) {
    console.error(listed.stderr || listed.stdout);
    process.exit(1);
  }
  all = JSON.parse(listed.stdout.trim() || '[]');
}
const pendingFile = join(root, 'scripts/reproducible-pending.json');
const pending = existsSync(pendingFile) ? JSON.parse(readFileSync(pendingFile, 'utf8')) : {};
const holdFile = join(root, 'scripts/pool-hold.json');
const held = poolHold();
const host = [];
const slicc = [];
const rebuild = [];
const test = [];
const pool = [];

function recipe(p) {
  const r = spawnSync('node', [join(root, 'scripts/read-recipe.mjs'), p, '--json'], {
    encoding: 'utf8',
    cwd: root,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || `read-recipe.mjs ${p} failed`);
    process.exit(1);
  }
  return JSON.parse(r.stdout);
}

function reproducible(p, value, built) {
  if (value === undefined || value === null) return built;
  if (value === 'false') return false;
  if (value === 'true') return true;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    // path: package/<file> compares one file; same_path: <issue> rebuilds in
    // host-build's directory, for a build known to embed its path (#668).
    const keys = Object.keys(value);
    const ok =
      keys.length > 0 &&
      keys.every((k) => k === 'path' || k === 'same_path') &&
      (value.path === undefined || (typeof value.path === 'string' && /^package\/./.test(value.path))) &&
      (value.same_path === undefined || /^[1-9][0-9]*$/.test(String(value.same_path)));
    if (ok) return true;
  }
  console.error(`packages/${p}/recipe.yaml: reproducible must be true, false, or a map with path: package/<file> and/or same_path: <issue number>`);
  process.exit(1);
}

function poolHold() {
  if (!existsSync(holdFile)) return new Set();
  let list;
  try {
    list = JSON.parse(readFileSync(holdFile, 'utf8'));
  } catch (err) {
    console.error(`scripts/pool-hold.json: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(list) || !list.every((p) => typeof p === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(p))) {
    console.error('scripts/pool-hold.json must be a JSON array of package names');
    process.exit(1);
  }
  for (const p of list) {
    if (!existsSync(join(root, 'packages', p, 'recipe.yaml')) || recipe(p).runner !== 'pool') {
      console.error(`scripts/pool-hold.json: ${p} is not a runner: pool recipe`);
      process.exit(1);
    }
  }
  return new Set(list);
}

function onPool(p, r) {
  if (r.runner === 'pool') return !held.has(p);
  if (r.runner !== undefined && r.runner !== null) {
    console.error(`packages/${p}/recipe.yaml: runner must be pool, or absent for ubuntu-latest`);
    process.exit(1);
  }
  const repack = r.repack && typeof r.repack === 'object' && r.repack.from;
  return Boolean(repack) && !existsSync(join(root, 'packages', p, 'smoke.c')) && !hasTests(p);
}

function hasTests(p) {
  const dir = join(root, 'packages', p, 'test');
  if (!existsSync(dir)) return false;
  return existsSync(join(dir, 'package.json')) || readdirSync(dir).some((f) => f.endsWith('.test.mjs'));
}

for (const p of [...all]) {
  const r = recipe(p);
  if (r.builder === 'retired') {
    all.splice(all.indexOf(p), 1);
    continue;
  }
  if ((r.builder || 'slicc') !== 'host') {
    slicc.push(p);
    continue;
  }
  host.push(p);
  if (reproducible(p, r.reproducible, !(r.repack && typeof r.repack === 'object' && r.repack.from) && !Object.hasOwn(pending, p))) rebuild.push(p);
  if (hasTests(p)) test.push(p);
  if (onPool(p, r)) pool.push(p);
}
console.log(JSON.stringify({ all, host, slicc, rebuild, test, pool }));
