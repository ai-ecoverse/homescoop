import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runner pools come and go (cloud-run-bench and cloud-run retire after the move to cloud-run-job), so no
// workflow may name a pool itself: pools are chosen by the repo variables, and an unset variable falls back
// to a GitHub-hosted label. #789 made this so in a workflow since retired; #790's stale branch reverted it (#800).
const workflows = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'workflows');
const hosted = /^(ubuntu|windows|macos)-[\w.-]+$/;

for (const file of readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f))) {
  test(`${file}: runs-on names no runner pool`, () => {
    const lines = readFileSync(join(workflows, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(/^\s*runs-on:\s*(.+?)\s*$/);
      if (!m) return;
      const where = `${file}:${i + 1}: ${m[1]}`;
      for (const [, label] of m[1].matchAll(/\|\|\s*'([^']*)'/g)) assert.match(label, hosted, `${where} falls back to '${label}', not a GitHub-hosted label`);
      if (!m[1].includes('${{')) assert.match(m[1], hosted, `${where} names a runner directly`);
    });
  });
}
