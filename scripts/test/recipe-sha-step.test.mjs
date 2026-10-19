import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function stepRun(file, name) {
  const lines = readFileSync(join(root, '.github', 'workflows', file), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, name);
  const start = lines.findIndex((l, i) => i > at && l.trim() === 'run: |');
  const indent = lines[start + 1].match(/^ */)[0];
  const body = [];
  for (const l of lines.slice(start + 1)) {
    if (l.trim() && !l.startsWith(indent)) break;
    body.push(l.slice(indent.length));
  }
  return body.join('\n');
}

const STEP = stepRun('ladder-pr.yml', 'Download expanded source URLs and write sha256');

function runWith(refresh) {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-sha-step-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(join(root, 'scripts', 'gate.mjs'), join(dir, 'scripts', 'gate.mjs'));
    writeFileSync(join(dir, 'scripts', 'refresh-recipe-sha.mjs'), refresh);
    return spawnSync('bash', ['-c', STEP], { cwd: dir, encoding: 'utf8', env: { ...process.env, HOST: '["pkg"]' } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a pre-#1019 head (no verdict line in its refresh-recipe-sha.mjs) runs unwrapped, passes, and warns to merge main', () => {
  const r = runWith("console.log('refreshed', process.argv[2]);\n");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /refreshed pkg/);
  assert.match(r.stdout, /::warning::recipe-sha: this branch's refresh-recipe-sha\.mjs predates the verdict line/);
});

test('NEGATIVE: a head whose script has the verdict line is wrapped, so a silent exit 0 still fails with exit 3', () => {
  const r = runWith("// prints 'recipe-sha: PASS' in the real script; this one stays silent\nprocess.exit(0);\n");
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /::warning::recipe-sha/);
});

test('a head whose script prints its verdict passes through the wrapper, with no warning', () => {
  const r = runWith("console.log('recipe-sha: PASS 1 recipe');\n");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /recipe-sha: PASS 1 recipe/);
  assert.doesNotMatch(r.stdout, /::warning::recipe-sha/);
});

test('a pre-#1267 head, whose script takes every non-flag argument as a package, still gets only the package (the base goes in RECIPE_SHA_BASE)', () => {
  const r = runWith(
    "const names = process.argv.slice(2).filter((a) => !a.startsWith('-'));\n" +
      "if (names.join() !== 'pkg') { console.log('recipe-sha: FAIL ' + names.join()); process.exit(1); }\n" +
      "console.log('recipe-sha: PASS 1 recipe');\n"
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /recipe-sha: PASS 1 recipe/);
});
