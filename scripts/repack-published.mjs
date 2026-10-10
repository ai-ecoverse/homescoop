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
 * integrity). Its tar stream is copied entry by entry, headers included;
 * only package/package.json (and `files`) get the repo's bytes from
 * packages/<name>/package/. No npm pack of an extracted tree: that would
 * re-apply `files` globs, which differ between case-insensitive and Linux
 * filesystems. diff-published.mjs then checks the result: only package.json
 * "version" and @ai-ecoverse/* pins may differ from the base. host-run.sh
 * takes this path instead of build.sh when recipe.repack.from is set, so
 * ladder-pr / ladder-build produce the same tarball. Remove `repack:` when
 * the next release really rebuilds.
 *
 * Does not publish.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { pinErrors } from './check-exact-pins.mjs';
import { diffTarballs, fetchPublished, readTarball, sha256 } from './diff-published.mjs';

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
const baseEntries = readTarball(baseTgz);
const basePj = baseEntries.get('package/package.json');
if (!basePj) die(`${spec} has no package/package.json`);
const basePkg = JSON.parse(basePj.data.toString('utf8'));
if (basePkg.version !== from) die(`npm pack ${spec} gave ${basePkg.version}`);
const up = (p) => p.homescoop?.upstream;
if (up(basePkg) !== up(repoPkg)) die(`homescoop.upstream ${up(basePkg)} (base) != ${up(repoPkg)} (repo): a new upstream rebuilds; drop repack:`);

/** @type {Map<string, Buffer>} */
const replace = new Map();
for (const f of ['package.json', ...extra]) {
  const src = join(repoPkgDir, f);
  if (!existsSync(src)) die(`missing ${src}`);
  if (!baseEntries.has(`package/${f}`)) die(`${spec} has no package/${f} to replace`);
  replace.set(`package/${f}`, readFileSync(src));
}
const next = rewriteTarball(baseTgz, replace);
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

/**
 * Copy the base tar stream entry by entry, header bytes included; only the
 * entries in `replace` get new data (size + checksum rewritten). Unlike an
 * npm pack of the extracted tree, this cannot drop or add files (npm's
 * `files` globs are case-sensitive on Linux, e.g. "Media" vs media/).
 * @param {Buffer} tgz
 * @param {Map<string, Buffer>} replace
 */
function rewriteTarball(tgz, replace) {
  const buf = gunzipSync(tgz);
  const parts = [];
  const done = new Set();
  const str = (b) => {
    const i = b.indexOf(0);
    return b.subarray(0, i < 0 ? b.length : i).toString('utf8');
  };
  let off = 0;
  /** @type {Record<string, string>} */
  let pax = {};
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    if (h[124] & 0x80) die('base-256 tar sizes are not supported');
    const type = String.fromCharCode(h[156] || 0x30);
    const paxSize = type !== 'x' && 'size' in pax;
    const size = paxSize ? Number(pax.size) : parseInt(str(h.subarray(124, 136)).trim() || '0', 8);
    const end = off + 512 + Math.ceil(size / 512) * 512;
    let name = str(h.subarray(0, 100));
    const prefix = str(h.subarray(345, 500));
    if (str(h.subarray(257, 263)).startsWith('ustar') && prefix) name = `${prefix}/${name}`;
    if (type === 'x') {
      pax = {};
      const text = buf.subarray(off + 512, off + 512 + size).toString('utf8');
      for (const m of text.matchAll(/^\d+ ([^=\n]+)=(.*)$/gm)) pax[m[1]] = m[2];
      parts.push(buf.subarray(off, end));
      off = end;
      continue;
    }
    if (type === 'L' || type === 'g' || type === 'K') die(`tar entry type ${type} not supported`);
    if (pax.path) name = pax.path;
    pax = {};
    const data = replace.get(name);
    if (data && (type === '0' || type === '\0')) {
      if (paxSize) die(`${name}: pax size header not supported`);
      if (data.length > 0o77777777777) die(`${name}: too large`);
      const nh = Buffer.from(h);
      nh.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'latin1');
      nh.fill(0x20, 148, 156);
      let sum = 0;
      for (const b of nh) sum += b;
      nh.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'latin1');
      const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
      data.copy(padded);
      parts.push(nh, padded);
      done.add(name);
    } else {
      parts.push(buf.subarray(off, end));
    }
    off = end;
  }
  for (const k of replace.keys()) if (!done.has(k)) die(`${k} not replaced`);
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}
