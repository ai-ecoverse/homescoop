#!/usr/bin/env node
/**
 * Compare two package tarballs entry by entry: path, type, mode, link and
 * content. Shared by npm-parity (a build against the published version) and
 * pool-parity (a pool build against its hosted twin).
 *
 *   node scripts/tarball-parity.mjs <a.tgz> <b.tgz> [--labels <a>,<b>]
 *
 * Exits 0 when every entry is the same, 1 otherwise, listing the entries
 * that differ.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readTarball, sha256 } from './diff-published.mjs';

const oct = (m) => m.toString(8).padStart(4, '0');

export function compareTarballs(a, b, { labels = ['a', 'b'] } = {}) {
  const [la, lb] = labels;
  const ea = readTarball(a);
  const eb = readTarball(b);
  const diffs = [];
  for (const [path, x] of ea) {
    const y = eb.get(path);
    if (!y) {
      diffs.push({ path, what: `only in ${la}` });
      continue;
    }
    const what = [];
    if (x.type !== y.type) what.push(`type ${x.type} in ${la}, ${y.type} in ${lb}`);
    if (x.mode !== y.mode) what.push(`mode ${oct(x.mode)} in ${la}, ${oct(y.mode)} in ${lb}`);
    if (x.link !== y.link) what.push(`link ${x.link || '-'} in ${la}, ${y.link || '-'} in ${lb}`);
    if (x.sha256 !== y.sha256) what.push(`content ${x.size} B ${x.sha256.slice(0, 12)} in ${la}, ${y.size} B ${y.sha256.slice(0, 12)} in ${lb}`);
    if (what.length) diffs.push({ path, what: what.join('; ') });
  }
  for (const path of eb.keys()) if (!ea.has(path)) diffs.push({ path, what: `only in ${lb}` });
  diffs.sort((p, q) => (p.path < q.path ? -1 : p.path > q.path ? 1 : 0));
  return {
    same: diffs.length === 0,
    sha256: { [la]: sha256(a), [lb]: sha256(b) },
    bytesSame: sha256(a) === sha256(b),
    entries: { [la]: ea.size, [lb]: eb.size },
    diffs,
  };
}

export function describe(res, { max = 20 } = {}) {
  if (res.same) return [];
  const lines = res.diffs.slice(0, max).map((d) => `  ${d.path}: ${d.what}`);
  if (res.diffs.length > max) lines.push(`  … and ${res.diffs.length - max} more`);
  return lines;
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--labels');
  const labels = i >= 0 ? args.splice(i, 2)[1].split(',') : ['a', 'b'];
  if (args.length !== 2 || labels.length !== 2) {
    console.error('usage: tarball-parity.mjs <a.tgz> <b.tgz> [--labels <a>,<b>]');
    return 2;
  }
  const res = compareTarballs(readFileSync(args[0]), readFileSync(args[1]), { labels });
  for (const l of labels) console.log(`${l}: sha256 ${res.sha256[l]}, ${res.entries[l]} entries`);
  if (res.same) {
    console.log(`tarball-parity: every entry is the same${res.bytesSame ? ' (byte-identical tarballs)' : ' (the tarballs\' bytes differ, their entries do not)'}`);
    return 0;
  }
  console.log(`tarball-parity: ${res.diffs.length} entr${res.diffs.length === 1 ? 'y differs' : 'ies differ'}:`);
  for (const line of describe(res, { max: 200 })) console.log(line);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exit(main());
