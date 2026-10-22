// Test helper: .github/workflows/ladder-build.yml, the one workflow, and its jobs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const WORKFLOW = fileURLToPath(new URL('../../.github/workflows/ladder-build.yml', import.meta.url));
export const text = readFileSync(WORKFLOW, 'utf8');

/** Each job's id → its text (the `  <id>:` line through the line before the next job). */
export function jobs(yml = text) {
  const body = yml.slice(yml.indexOf('\njobs:\n') + 1);
  const out = {};
  let current;
  for (const line of body.split('\n').slice(1)) {
    const m = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (m) {
      current = m[1];
      out[current] = `${line}\n`;
    } else if (current) out[current] += `${line}\n`;
  }
  return out;
}

export function job(name, yml = text) {
  const found = jobs(yml)[name];
  if (!found) throw new Error(`ladder-build.yml has no job ${name}`);
  return found;
}
