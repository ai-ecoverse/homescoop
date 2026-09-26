#!/usr/bin/env node
/**
 * Classify touched packages by recipe.builder for CI matrices.
 *
 *   node scripts/classify-touched-packages.mjs --base A --head B
 *   → JSON { host: string[], slicc: string[], all: string[] }
 */
import { spawnSync } from 'node:child_process';
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
for (const p of all) {
  const r = spawnSync(
    'node',
    [join(root, 'scripts/read-recipe.mjs'), p, '--field', 'builder'],
    { encoding: 'utf8', cwd: root }
  );
  const b = (r.stdout || '').trim() || 'slicc';
  if (b === 'host') host.push(p);
  else slicc.push(p);
}
console.log(JSON.stringify({ all, host, slicc }));
