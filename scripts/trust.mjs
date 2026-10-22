#!/usr/bin/env node
/**
 * npm run trust / trust:dry: fledgling over every packages/<name>/package.
 *
 * The root package.json has no `workspaces`, so the pipeline's `npm ci`
 * installs only the root devDependencies (a workspace per recipe put every
 * recipe's version in the lockfile, so each version bump broke npm ci).
 * fledgling finds packages through `workspaces`, so this adds WORKSPACES to
 * package.json for the one fledgling run and puts the file back afterwards.
 *
 *   node scripts/trust.mjs [fledgling sync args…]
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKSPACES = ['packages/*/package'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function withWorkspaces(text, workspaces = WORKSPACES) {
  const json = JSON.parse(text);
  if (json.workspaces) throw new Error('package.json already has workspaces; remove them, scripts/trust.mjs adds its own');
  return `${JSON.stringify({ ...json, workspaces }, null, 2)}\n`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const file = join(root, 'package.json');
  const before = readFileSync(file, 'utf8');
  writeFileSync(file, withWorkspaces(before));
  let status = 1;
  try {
    status = spawnSync('npx', ['fledgling', 'sync', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' }).status ?? 1;
  } finally {
    writeFileSync(file, before);
  }
  process.exit(status);
}
