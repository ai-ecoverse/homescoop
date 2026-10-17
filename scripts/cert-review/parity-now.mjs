import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { npmParity } from '../npm-parity.mjs';

const one = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

export function parityNow({ artifacts, pr, check = (buf) => npmParity(buf, { drift: 'fail' }) }) {
  const pattern = new RegExp(`^host-(.+)-pr${pr}$`);
  const out = {};
  for (const dir of readdirSync(artifacts).sort()) {
    const match = dir.match(pattern);
    if (!match) continue;
    const tgz = join(artifacts, dir, 'package.tgz');
    try {
      if (!existsSync(tgz)) throw new Error(`${dir} has no package.tgz`);
      const r = check(readFileSync(tgz));
      out[match[1]] = { verdict: r.verdict, name: r.name, version: r.version, latest: r.latest ?? null, message: one(r.message) };
    } catch (error) {
      out[match[1]] = { verdict: 'error', message: one(error.message) };
    }
  }
  return out;
}

export function parityProblem(r) {
  if (!r || typeof r !== 'object') return { tag: 'INCOMPLETE', why: "npm parity didn't run for it at record time" };
  if (r.verdict === 'new' || r.verdict === 'same') return null;
  if (r.verdict === 'behind') return { tag: 'BEHIND', why: `npm at record time: ${one(r.message)}` };
  if (r.verdict === 'drift') return { tag: 'DRIFT', why: `npm at record time: ${one(r.message)}` };
  return { tag: 'INCOMPLETE', why: `npm parity at record time failed: ${one(r.message) || one(r.verdict) || 'no verdict'}` };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const { values } = parseArgs({ options: { artifacts: { type: 'string' }, pr: { type: 'string' }, out: { type: 'string' } } });
  if (!values.artifacts || !values.pr || !values.out) {
    console.error('usage: parity-now.mjs --artifacts <dir> --pr <n> --out <parity.json>');
    process.exit(2);
  }
  const result = parityNow({ artifacts: values.artifacts, pr: values.pr });
  writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
  for (const [recipe, r] of Object.entries(result)) console.log(`${recipe}: ${r.verdict}: ${r.message}`);
}
