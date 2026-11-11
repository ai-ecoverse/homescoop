import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const LICENCE = /^(LICEN[CS]E|COPYING|NOTICE|UNLICENSE|COPYRIGHT)/i;
const HOMESCOOP_CRATES = '/homescoop-crates/';

export function licenceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => LICENCE.test(e.name))
    .flatMap((e) => (e.isDirectory() ? readdirSync(join(dir, e.name)).sort().map((f) => join(e.name, f)) : [e.name]))
    .sort();
}

export function homescoopPatchedCratePath(name, version, path) {
  if (!path) return false;
  const norm = String(path).replace(/\\/g, '/');
  const i = norm.indexOf(HOMESCOOP_CRATES);
  if (i < 0) return false;
  const base = norm.slice(i + HOMESCOOP_CRATES.length).split('/')[0];
  return base === `${name}-${version}`;
}

export function treeCrates(tree) {
  const out = new Set();
  tree.split('\n').filter(Boolean).forEach((line, i) => {
    if (i === 0) return;
    const m = line.match(/^(\S+) v(\S+)(?: \((.+)\))?$/);
    if (!m) return;
    const [, name, version, loc] = m;
    if (loc) {
      const norm = loc.replace(/\\/g, '/');
      if (norm.startsWith('/') && !homescoopPatchedCratePath(name, version, norm)) return;
    }
    out.add(`${name} ${version}`);
  });
  return out;
}
