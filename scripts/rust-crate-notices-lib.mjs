import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const LICENCE = /^(LICEN[CS]E|COPYING|NOTICE|UNLICENSE|COPYRIGHT)/i;

export function licenceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => LICENCE.test(e.name))
    .flatMap((e) => (e.isDirectory() ? readdirSync(join(dir, e.name)).sort().map((f) => join(e.name, f)) : [e.name]))
    .sort();
}

export function treeCrates(tree) {
  const out = new Set();
  tree.split('\n').filter(Boolean).forEach((line, i) => {
    if (i === 0 || line.includes('(/')) return;
    const m = line.match(/^(\S+) v(\S+)/);
    if (m) out.add(`${m[1]} ${m[2]}`);
  });
  return out;
}
