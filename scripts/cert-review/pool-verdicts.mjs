import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function verdictRows({ dir, want, compare }) {
  const rows = [];
  const top = existsSync(dir) ? readdirSync(dir) : [];
  const stray = top.filter((f) => !want.some((p) => f === `verdict-${p}`));
  for (const p of want) {
    const file = join(dir, `verdict-${p}`, `${p}.tsv`);
    const own = existsSync(file)
      ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')).filter((r) => r[0] === p)
      : [];
    rows.push(own.length === 1 ? own[0] : [p, 'no verdict', own.length ? `verdict-${p} has ${own.length} rows` : 'a build failed or was cancelled', '']);
  }
  if (stray.length) rows.push(['(layout)', 'no verdict', `not a planned verdict-<recipe> directory: ${stray.join(' ')}`, '']);
  if (compare !== 'success' && rows.every((r) => r[1] === 'same')) {
    rows.push(['(compare)', 'no verdict', `a compare leg ended ${compare}, yet every verdict says same`, '']);
  }
  return rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
