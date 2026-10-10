#!/usr/bin/env node
/**
 * Packaging-only release: repack a published tarball with the repo's
 * package.json, no rebuild.
 *
 *   node scripts/repack-published.mjs <package> [--out DIR]
 *   → DIR/package.tgz, package.tgz.sha256, packaging-only-diff.txt
 *     (default DIR = $HOMESCOOP_OUT or .homescoop-out)
 *
 * Driven by recipe.yaml:
 *
 *   repack:
 *     from: "0.1.0-1"      # published version whose bytes are reused
 *     files:               # optional; repo files laid over the base
 *       - README.md        # (package.json always is)
 *
 * The base is `npm pack <recipe.npm>@<from>` (npm checks the registry
 * integrity). Its files are kept byte for byte; the repo's
 * packages/<name>/package/package.json (and `files`) replace theirs, then
 * npm pack. diff-published.mjs then checks the result: only package.json
 * "version" and @ai-ecoverse/* pins may differ from the base. host-run.sh
 * takes this path instead of build.sh when recipe.repack.from is set, so
 * ladder-pr / ladder-build produce the same tarball. Remove `repack:` when
 * the next release really rebuilds.
 *
 * Does not publish.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinErrors } from './check-exact-pins.mjs';
import { diffTarballs, fetchPublished, sha256 } from './diff-published.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let name;
let outDir = process.env.HOMESCOOP_OUT || join(root, '.homescoop-out');
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') outDir = args[++i];
  else if (!name && !args[i].startsWith('-')) name = args[i];
  else {
    console.error(`unknown argument ${args[i]}`);
    process.exit(2);
  }
}
if (!name) {
  console.error('usage: repack-published.mjs <package> [--out DIR]');
  process.exit(2);
}
outDir = resolve(outDir);

const die = (msg) => {
  console.error(`repack-published (${name}): ${msg}`);
  process.exit(1);
};
const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', ...opts });
  if (r.status !== 0) die(`${cmd} ${argv.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return (r.stdout || '').trim();
};

const recipe = JSON.parse(run(process.execPath, [join(root, 'scripts/read-recipe.mjs'), name, '--json']));
const from = String(recipe.repack?.from || '');
if (!from) die('recipe has no repack.from');
const extra = Array.isArray(recipe.repack?.files) ? recipe.repack.files.map(String) : [];
for (const f of extra) {
  if (f === 'package.json' || f.includes('..') || f.startsWith('/')) die(`bad repack.files entry ${f}`);
}
const repoPkgDir = join(root, 'packages', name, 'package');
const repoPkg = JSON.parse(readFileSync(join(repoPkgDir, 'package.json'), 'utf8'));
if (recipe.npm && repoPkg.name !== recipe.npm) die(`package.json name ${repoPkg.name} != recipe npm ${recipe.npm}`);
if (repoPkg.version === from) die(`package.json version ${from} is the base; bump -N`);
const pins = pinErrors(repoPkg);
if (pins.length) die(`not exact:\n  - ${pins.join('\n  - ')}`);

const spec = `${repoPkg.name}@${from}`;
console.log(`== repack-published: ${spec} + packages/${name}/package/{${['package.json', ...extra].join(',')}} → ${repoPkg.version}`);
const baseTgz = fetchPublished(spec);
const work = mkdtempSync(join(tmpdir(), `repack-${name}-`));
try {
  writeFileSync(join(work, 'base.tgz'), baseTgz);
  run('tar', ['-xzf', join(work, 'base.tgz'), '-C', work]);
  const pkgDir = join(work, 'package');
  const basePkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  if (basePkg.version !== from) die(`npm pack ${spec} gave ${basePkg.version}`);
  const up = (p) => p.homescoop?.upstream;
  if (up(basePkg) !== up(repoPkg)) die(`homescoop.upstream ${up(basePkg)} (base) != ${up(repoPkg)} (repo): a new upstream rebuilds; drop repack:`);
  for (const f of ['package.json', ...extra]) {
    const src = join(repoPkgDir, f);
    if (!existsSync(src)) die(`missing ${src}`);
    mkdirSync(dirname(join(pkgDir, f)), { recursive: true });
    copyFileSync(src, join(pkgDir, f));
  }
  const packDir = join(work, 'out');
  mkdirSync(packDir);
  run('npm', ['pack', pkgDir, '--pack-destination', packDir, '--ignore-scripts', '--silent']);
  const tgzName = readdirSync(packDir).find((f) => f.endsWith('.tgz'));
  if (!tgzName) die('npm pack produced no tarball');
  const next = readFileSync(join(packDir, tgzName));
  const res = diffTarballs(next, baseTgz, { allow: extra, baseLabel: spec });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'packaging-only-diff.txt'), `${res.report}\n`);
  console.log(res.report);
  if (!res.ok) die(`not packaging-only:\n  - ${res.errors.join('\n  - ')}`);
  const dest = join(outDir, 'package.tgz');
  writeFileSync(dest, next);
  writeFileSync(`${dest}.sha256`, `${sha256(next)}  package.tgz\n`);
  console.log(`== repack-published: ${dest}`);
  console.log(`${repoPkg.name}@${repoPkg.version} sha256 ${sha256(next)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
