#!/usr/bin/env node
/**
 * Publish 0.0.0 stubs for every packages/*/package that is not yet on npm.
 * Requires NPM_TOKEN (or an existing `npm whoami` session).
 *
 *   NPM_TOKEN=npm_… node scripts/reserve-names.mjs
 *   node scripts/reserve-names.mjs --dry-run
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dryRun = process.argv.includes('--dry-run');
const token = process.env.NPM_TOKEN;
const root = new URL('../packages', import.meta.url).pathname;

function npm(args, opts = {}) {
  const env = { ...process.env };
  if (token) {
    // registry auth via env for non-interactive publish
    env.NPM_CONFIG_USERCONFIG = opts.userconfig ?? env.NPM_CONFIG_USERCONFIG;
  }
  const r = spawnSync('npm', args, {
    encoding: 'utf8',
    env,
    cwd: opts.cwd,
  });
  return r;
}

function existsOnNpm(name) {
  const r = npm(['view', name, 'version', '--json']);
  if (r.status === 0) return true;
  const err = `${r.stderr || ''}${r.stdout || ''}`;
  if (/E404|404 Not Found/i.test(err)) return false;
  throw new Error(`npm view ${name} failed: ${err || r.status}`);
}

if (!token && !dryRun) {
  // allow interactive npm whoami
  const who = npm(['whoami']);
  if (who.status !== 0) {
    console.error('Set NPM_TOKEN or run `npm login`, then retry.');
    process.exit(1);
  }
  console.log(`npm whoami: ${who.stdout.trim()}`);
}

const names = readdirSync(root).sort();
let claimed = 0;
let skipped = 0;

for (const name of names) {
  const dir = join(root, name, 'package');
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  process.stdout.write(`${pkg.name} … `);
  if (existsOnNpm(pkg.name)) {
    console.log('exists, skip');
    skipped++;
    continue;
  }
  if (dryRun) {
    console.log('would publish 0.0.0');
    claimed++;
    continue;
  }
  const userconfig = join(tmpdir(), `homescoop-npmrc-${process.pid}`);
  if (token) {
    writeFileSync(
      userconfig,
      `//registry.npmjs.org/:_authToken=${token}\nalways-auth=true\n`
    );
  }
  const pub = npm(
    ['publish', dir, '--access', 'public', ...(token ? [`--userconfig=${userconfig}`] : [])],
    { userconfig }
  );
  if (pub.status !== 0) {
    console.log('FAIL');
    console.error(pub.stderr || pub.stdout);
    process.exit(1);
  }
  console.log('published 0.0.0');
  claimed++;
}

console.log(`\nDone. claimed=${claimed} skipped=${skipped}`);
