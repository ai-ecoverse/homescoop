#!/usr/bin/env node
/**
 * Classify touched packages by recipe.builder for CI matrices.
 *
 *   node scripts/classify-touched-packages.mjs --base A --head B
 *   → JSON { host: string[], slicc: string[], all: string[] }
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let base, head;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--base') base = args[++i];
  else if (args[i] === '--head') head = args[++i];
}
if (!base || !head) {
  console.error('usage: classify-touched-packages.mjs --base <ref> --head <ref>');
  process.exit(2);
}

const listed = spawnSync(
  'node',
  [join(root, 'scripts/list-touched-packages.mjs'), '--base', base, '--head', head, '--json'],
  { encoding: 'utf8', cwd: root }
);
if (listed.status !== 0) {
  console.error(listed.stderr || listed.stdout);
  process.exit(1);
}
/** @type {string[]} */
const all = JSON.parse(listed.stdout.trim() || '[]');
const host = [];
const slicc = [];
const rebuild = [];
const test = [];

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

function reproducible(p, value) {
  if (value === undefined || value === null || value === 'false') return false;
  if (value === 'true') return true;
  if (value && typeof value === 'object' && typeof value.path === 'string' && /^package\/./.test(value.path)) return true;
  console.error(`packages/${p}/recipe.yaml: reproducible must be true, false, or a map with path: package/<file>`);
  process.exit(1);
}

function hasTests(p) {
  const dir = join(root, 'packages', p, 'test');
  if (!existsSync(dir)) return false;
  return existsSync(join(dir, 'package.json')) || readdirSync(dir).some((f) => f.endsWith('.test.mjs'));
}

for (const p of all) {
  const r = recipe(p);
  if ((r.builder || 'slicc') !== 'host') {
    slicc.push(p);
    continue;
  }
  host.push(p);
  if (reproducible(p, r.reproducible)) rebuild.push(p);
  if (hasTests(p)) test.push(p);
}
console.log(JSON.stringify({ all, host, slicc, rebuild, test }));
