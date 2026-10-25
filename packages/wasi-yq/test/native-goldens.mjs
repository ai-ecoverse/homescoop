import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { cases, compare, files, fixtures, observed, stdin, tempFiles } from './goldens.mjs';

const [given, mode] = process.argv.slice(2);
const binary = resolve(given);
const root = mkdtempSync(join(tmpdir(), 'wasi-yq-goldens-'));
const out = {};
let bad = [];
cases.forEach((c, i) => {
  const dir = join(root, String(i));
  const tmp = join(root, `tmp-${i}`);
  mkdirSync(dir);
  mkdirSync(tmp);
  for (const [name, text] of Object.entries(files(c))) writeFileSync(join(dir, name), text);
  const r = spawnSync(binary, c.args, { cwd: dir, input: stdin(c) ?? '', env: { PATH: '/usr/bin:/bin', TMPDIR: tmp, ...c.env }, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  const after = c.after ? readFileSync(join(dir, c.after), 'utf8') : undefined;
  const o = observed(c, r, after, c.after ? tempFiles(readdirSync(tmp)) : undefined);
  out[c.name] = o;
  if (mode !== '--write') bad = bad.concat(compare(c, o));
});
rmSync(root, { recursive: true, force: true });
if (mode === '--write') writeFileSync(new URL('expected.json', fixtures), `${JSON.stringify(out, null, 1)}\n`);
if (bad.length) {
  for (const b of bad.slice(0, 20)) console.error(`native-goldens: ${b}`);
  console.error(`native-goldens: FAIL ${bad.length} differences in ${cases.length} cases`);
  process.exit(1);
}
console.log(`native-goldens: PASS ${cases.length} cases${mode === '--write' ? ' (written)' : ''}`);
