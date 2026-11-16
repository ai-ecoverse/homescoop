#!/usr/bin/env node
/**
 * Reserve the npm name of every packages/<name>/package that npm doesn't
 * have yet, with a 0.0.0 stub: a package.json and a README, nothing else,
 * so the name exists for `npm run trust` (trusted publishing needs a
 * package to attach to). The real version comes later from ladder-build's
 * OIDC publish, never from here.
 *
 * The stub is written to a temporary directory. Until this was fixed, the
 * script ran `npm publish packages/<name>/package`, the real package at its
 * real version, unbuilt, for every name without a 0.0.0 (also names npm had
 * under other versions): on wasm-binutils it tried 2.47.0-8 and stopped only
 * because npm wants --tag for a prerelease.
 *
 * A name counts as reserved when npm has any version of it: its packument
 * answers, or its 0.0.0 or 0.0.0-stage does (a fresh scoped name can 404 on
 * the packument while the version document is public already).
 *
 *   NPM_TOKEN=npm_… node scripts/reserve-names.mjs [<recipe> …]
 *   node scripts/reserve-names.mjs --dry-run [<recipe> …]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STUB_VERSION = '0.0.0';
const root = fileURLToPath(new URL('../packages', import.meta.url));
const REGISTRY = 'https://registry.npmjs.org/';

/** The stub's package.json: the name and the metadata npm shows, no files, no scripts, no dependencies. */
export function stubManifest(pkg, recipe) {
  if (!pkg?.name) throw new Error(`packages/${recipe}/package/package.json has no name`);
  return {
    name: pkg.name,
    version: STUB_VERSION,
    description: `Name reserved for ${pkg.name}${pkg.description ? `: ${pkg.description}` : ''} Install a later version; 0.0.0 is empty.`,
    ...(pkg.license ? { license: pkg.license } : {}),
    repository: pkg.repository ?? {
      type: 'git',
      url: 'git+https://github.com/ai-ecoverse/homescoop.git',
      directory: `packages/${recipe}/package`,
    },
    homepage: pkg.homepage ?? `https://github.com/ai-ecoverse/homescoop/tree/main/packages/${recipe}`,
    publishConfig: { access: 'public' },
  };
}

export function stubReadme(pkg, recipe) {
  return `# ${pkg.name}\n\nThis 0.0.0 only reserves the name. The package is built from\n[homescoop/packages/${recipe}](https://github.com/ai-ecoverse/homescoop/tree/main/packages/${recipe})\nand published there by CI; install a later version.\n`;
}

/** Write the stub into a new temporary directory and return its path. */
export function writeStub(pkg, recipe, parent = tmpdir()) {
  const dir = mkdtempSync(join(parent, 'homescoop-reserve-'));
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(stubManifest(pkg, recipe), null, 2)}\n`);
  writeFileSync(join(dir, 'README.md'), stubReadme(pkg, recipe));
  return dir;
}

/** Whether npm has the name under any version (see the header). */
export async function reservedOnNpm(name, { fetch: get = fetch, token } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  for (const path of ['', `/${STUB_VERSION}`, `/${STUB_VERSION}-stage`]) {
    const url = `${REGISTRY}${encodeURIComponent(name)}${path}`;
    const res = await get(url, { headers });
    if (res.status === 200) return true;
    if (res.status !== 404) throw new Error(`registry GET ${url} -> ${res.status}`);
  }
  return false;
}

function retired(recipe) {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./read-recipe.mjs', import.meta.url)), recipe, '--field', 'builder'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === 'retired';
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  const only = argv.filter((a) => !a.startsWith('--'));
  const token = process.env.NPM_TOKEN;
  if (!token && !dryRun) {
    const who = spawnSync('npm', ['whoami'], { encoding: 'utf8' });
    if (who.status !== 0) {
      console.error('Set NPM_TOKEN or run `npm login`, then retry.');
      process.exit(1);
    }
    console.log(`npm whoami: ${who.stdout.trim()}`);
  }
  for (const r of only) {
    if (!existsSync(join(root, r, 'package', 'package.json'))) throw new Error(`no packages/${r}/package/package.json`);
  }

  const work = mkdtempSync(join(tmpdir(), 'homescoop-reserve-run-'));
  let claimed = 0;
  let skipped = 0;
  try {
    let userconfig;
    if (token) {
      userconfig = join(work, 'npmrc');
      writeFileSync(userconfig, `//registry.npmjs.org/:_authToken=${token}\n`, { mode: 0o600 });
    }
    for (const recipe of only.length ? only : readdirSync(root).sort()) {
      const pkgPath = join(root, recipe, 'package', 'package.json');
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg.private || retired(recipe)) {
        console.log(`${pkg.name} … private/retired, skip`);
        skipped++;
        continue;
      }
      process.stdout.write(`${pkg.name} … `);
      if (await reservedOnNpm(pkg.name, { token })) {
        console.log('on npm, skip');
        skipped++;
        continue;
      }
      if (dryRun) {
        console.log(`would publish a ${STUB_VERSION} stub`);
        claimed++;
        continue;
      }
      const dir = writeStub(pkg, recipe, work);
      const pub = spawnSync('npm', ['publish', dir, '--access', 'public', '--tag', 'latest', ...(userconfig ? [`--userconfig=${userconfig}`] : [])], { encoding: 'utf8' });
      if (pub.status !== 0) {
        console.log('FAIL');
        console.error(pub.stderr || pub.stdout);
        process.exit(1);
      }
      console.log(`published a ${STUB_VERSION} stub`);
      claimed++;
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`\nDone. claimed=${claimed} skipped=${skipped}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
