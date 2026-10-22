import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const self = relative(root, fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(['node_modules', 'target', '.work', 'licence-texts', '.homescoop-out']);

const RETIRED = /(?<![\w-])(kernel-compat(?:-proof)?|ladder-pr|ladder-merge|pr-review|pool-parity|pnpm-agent-loop)(?![\w-])|(?<![\w-])cert-review(?![\w/-])/;

const ALLOWED = new Map([
  ['scripts/issue-labels.mjs', 'it labels issue titles, and titles still name the retired workflows (#1713 does)'],
  ['scripts/test/issue-labels.test.mjs', 'its table is real issue titles'],
  ['scripts/test/certification-exceptions.test.mjs', "published wasm-tar 1.35.0-8's npm provenance names ladder-pr.yml"],
]);

function walk(dir, keep) {
  const out = [];
  for (const d of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, d.name);
    if (d.isDirectory()) {
      if (!SKIP_DIRS.has(d.name)) out.push(...walk(rel, keep));
    } else if (d.isFile() && keep(rel)) out.push(rel);
  }
  return out;
}

function swept() {
  const readme = (f) => f.endsWith('README.md');
  return [
    ...walk('scripts', () => true),
    ...walk('docs', () => true),
    ...walk('crates', readme),
    ...walk('shims', readme),
    ...['README.md', 'AGENTS.md'].filter((f) => existsSync(join(root, f))),
  ].filter((f) => f !== self && statSync(join(root, f)).size < 4 * 1024 * 1024);
}

test('scripts/, docs/ and the READMEs name no retired workflow (#1697, #1713)', () => {
  const hits = [];
  for (const file of swept()) {
    if (ALLOWED.has(file)) continue;
    readFileSync(join(root, file), 'utf8').split('\n').forEach((line, i) => {
      const m = RETIRED.exec(line);
      if (m) hits.push(`${file}:${i + 1}: ${m[0]}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('every .github/workflows file the docs and READMEs name exists', () => {
  const missing = [];
  for (const file of swept().filter((f) => f.endsWith('.md'))) {
    for (const [path] of readFileSync(join(root, file), 'utf8').matchAll(/\.github\/workflows\/[\w.-]+\.ya?ml/g)) {
      if (!existsSync(join(root, path))) missing.push(`${file}: ${path}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('each allowed file still names a retired workflow, or it comes off the list', () => {
  for (const [file, why] of ALLOWED) {
    assert.match(readFileSync(join(root, file), 'utf8'), RETIRED, `${file} (${why})`);
  }
});

test('nothing runs scripts/cert-review/artifacts.mjs any more, so it is gone', () => {
  assert.equal(existsSync(join(root, 'scripts/cert-review/artifacts.mjs')), false);
});
