#!/usr/bin/env node
/**
 * Publish 0.0.0 stubs for every packages/<name>/package that is not yet on npm.
 * Requires NPM_TOKEN (or an existing `npm whoami` session).
 *
 *   NPM_TOKEN=npm_… node scripts/reserve-names.mjs
 *   node scripts/reserve-names.mjs --dry-run
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
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

/**
 * Prefer the version document over `npm view` / package root.
 * Fresh scoped packages often return 404 on GET /@scope%2fname while
 * /@scope%2fname/0.0.0 and the tarball are already public (name reserved).
 */
async function existsOnNpm(name, version = '0.0.0') {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`registry GET ${url} -> ${res.status}`);
}

async function main() {
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
    if (await existsOnNpm(pkg.name)) {
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
      [
        'publish',
        dir,
        '--access',
        'public',
        ...(token ? [`--userconfig=${userconfig}`] : []),
      ],
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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
