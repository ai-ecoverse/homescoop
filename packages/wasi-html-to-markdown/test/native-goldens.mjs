import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { cases, fixtures, matches, sha256 } from './goldens.mjs';

const [binary, mode] = process.argv.slice(2);
let bad = 0;
for (const c of cases) {
  const r = spawnSync(binary, c.args, { input: c.input(), encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    console.error(`native-goldens: ${c.name}: rc ${r.status} ${r.stderr}`);
    bad++;
    continue;
  }
  if (mode === '--write') {
    if (c.golden) writeFileSync(new URL(c.golden, fixtures), r.stdout);
    if (c.digest) writeFileSync(new URL(c.digest, fixtures), `${JSON.stringify({ sha256: sha256(r.stdout), bytes: Buffer.byteLength(r.stdout) })}\n`);
  } else if (!matches(c, r.stdout)) {
    console.error(`native-goldens: ${c.name}: native output differs from the committed golden`);
    bad++;
  }
}
if (bad) {
  console.error(`native-goldens: FAIL ${bad} of ${cases.length} cases`);
  process.exit(1);
}
console.log(`native-goldens: PASS ${cases.length} cases${mode === '--write' ? ' (written)' : ''}`);
