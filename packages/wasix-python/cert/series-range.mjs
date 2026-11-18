import { readFileSync } from 'node:fs';
import { satisfies } from '../../../scripts/cert-kernel-floor.mjs';

const PKG = JSON.parse(readFileSync(new URL('../package/package.json', import.meta.url), 'utf8'));
const LAST = 29;
const pythonSeries = (floor) => {
  const [x, y, z] = floor.split('-')[0].split('.').map(Number);
  const lines = [`>=${floor} <${x}.${y}.${z + 1}`];
  for (let p = z + 1; p <= LAST; p++) lines.push(`>=${x}.${y}.${p}-1 <${x}.${y}.${p + 1}`);
  return lines.join(' || ');
};

export default async function (ctx) {
  const { run, write, assert } = ctx;
  const version = PKG.version;
  const [x, y] = version.split('.').map(Number);
  const series = pythonSeries(`${x}.${y}.0-1`);
  const patch = `>=${x}.${y}.0-1 <${x}.${y}.1`;
  const probes = [version, `${x}.${y}.0-1`, `${x}.${y}.0-10`, `${x}.${y}.1-1`, `${x}.${y}.2-1`, `${x}.${y}.2-0`, `${x}.${y}.29-4`, `${x}.${y}.30-1`, `${x}.${y + 1}.0-1`, `${x}.${y - 1}.10-1`];
  const cases = [];
  for (const spec of [series, patch, pythonSeries(`${x}.${y}.0-8`)]) for (const v of probes) cases.push([v, spec]);
  await write('/tmp/series_range.py', 'import json, sys, _slicc_site\nprint(json.dumps([_slicc_site._in_range(v, s) for v, s in json.load(open(sys.argv[1]))]))\n');
  await write('/tmp/series_range.json', JSON.stringify(cases));
  const r = await run(['python3', '/tmp/series_range.py', '/tmp/series_range.json'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stderr}`);
  const got = JSON.parse(r.stdout.trim().split('\n').pop());
  cases.forEach(([v, spec], i) => {
    assert.equal(got[i], satisfies(v, spec), `_slicc_site._in_range(${v}, ${spec.slice(0, 40)}…) is ${got[i]}, npm semver says ${satisfies(v, spec)}`);
  });
  const idx = cases.findIndex(([v, spec]) => v === version && spec === series);
  assert.equal(got[idx], true, `this python ${version} is in its own series range`);
  console.log(`series-range: _slicc_site._in_range agrees with npm semver (cert-kernel-floor.satisfies) on ${cases.length} version/range pairs; ${version} is in pythonSeries('${x}.${y}.0-1'), ${x}.${y}.2-1 is not in ${patch}`);
}
