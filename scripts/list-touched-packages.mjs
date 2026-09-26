#!/usr/bin/env node
/**
 * List homescoop package names touched between two git refs (or from a file list).
 *
 *   node scripts/list-touched-packages.mjs --base origin/main --head HEAD
 *   node scripts/list-touched-packages.mjs --files <(git diff --name-only …)
 *   echo 'packages/zlib/recipe.yaml' | node scripts/list-touched-packages.mjs --stdin
 *
 * Prints one package name per line. Exits 0 even when empty (caller decides).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  /** @type {{ base?: string, head?: string, files?: string, stdin: boolean, json: boolean }} */
  const out = { stdin: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') out.base = argv[++i];
    else if (a === '--head') out.head = argv[++i];
    else if (a === '--files') out.files = argv[++i];
    else if (a === '--stdin') out.stdin = true;
    else if (a === '--json') out.json = true;
    else {
      console.error(
        'usage: list-touched-packages.mjs (--base <ref> --head <ref>) | --files <path> | --stdin [--json]'
      );
      process.exit(2);
    }
  }
  return out;
}

/** @param {string[]} paths */
function packagesFromPaths(paths) {
  const set = new Set();
  for (const p of paths) {
    const m = p.replace(/\\/g, '/').match(/^packages\/([^/]+)\//);
    if (!m) continue;
    const name = m[1];
    if (existsSync(join(root, 'packages', name, 'recipe.yaml'))) set.add(name);
  }
  return [...set].sort();
}

function gitDiffNames(base, head) {
  const r = spawnSync('git', ['diff', '--name-only', `${base}...${head}`], {
    encoding: 'utf8',
    cwd: root,
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || 'git diff failed');
    process.exit(1);
  }
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

const args = parseArgs(process.argv);
let paths = [];
if (args.stdin) {
  paths = readFileSync(0, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
} else if (args.files) {
  paths = readFileSync(args.files, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
} else if (args.base && args.head) {
  paths = gitDiffNames(args.base, args.head);
} else {
  console.error('need --base/--head, --files, or --stdin');
  process.exit(2);
}

const pkgs = packagesFromPaths(paths);
if (args.json) {
  console.log(JSON.stringify(pkgs));
} else {
  for (const p of pkgs) console.log(p);
}
