import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const LICENSE = 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software.\n';

function hostRun(readme) {
  const root = mkdtempSync(join(tmpdir(), 'homescoop-repack-'));
  try {
    mkdirSync(join(root, 'scripts'));
    for (const f of ['host-run.sh', 'read-recipe.mjs', 'check-exact-pins.mjs', 'gate.mjs', 'sync-package-version.mjs', 'check-package-meta.mjs', 'upstream-version-text.mjs', 'package-meta-versions.json', 'repack-published.mjs', 'diff-published.mjs']) {
      copyFileSync(join(scripts, f), join(root, 'scripts', f));
    }
    const pkg = join(root, 'packages', 'tool', 'package');
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(root, 'packages', 'tool', 'recipe.yaml'), 'name: tool\nbuilder: host\nversion: "1.2.3"\nnpm: "@ai-ecoverse/homescoop-test-not-published"\nsummary: "tool"\nrepack:\n  from: "1.2.3-1"\nabout:\n  license: MIT\n');
    writeFileSync(join(pkg, 'package.json'), `${JSON.stringify({ name: '@ai-ecoverse/homescoop-test-not-published', version: '1.2.3-2', description: 'tool', license: 'MIT', repository: { type: 'git', url: 'git+https://github.com/ai-ecoverse/homescoop.git', directory: 'packages/tool/package' }, files: ['README.md', 'LICENSE'], homescoop: { recipe: 'tool', upstream: '1.2.3' } }, null, 2)}\n`);
    writeFileSync(join(pkg, 'LICENSE'), LICENSE);
    writeFileSync(join(pkg, 'README.md'), readme);
    return spawnSync('bash', [join(root, 'scripts', 'host-run.sh'), 'tool'], { encoding: 'utf8', cwd: root, env: { ...process.env, HOMESCOOP_OUT: join(root, 'out') } });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('the repack path refuses drifted package text before it repacks', () => {
  const r = hostRun('# tool\n\ntool 1.2.2 for slicc.\n');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /== host-run: check package meta/);
  assert.match(r.stderr, /package\/README\.md:3 names 1\.2\.2, not recipe version 1\.2\.3/);
  assert.doesNotMatch(r.stdout, /repack-published/);
});

test('the repack path passes check-package-meta with clean text and goes on to repack', () => {
  const r = hostRun('# tool\n\ntool 1.2.3 for slicc.\n');
  assert.match(r.stdout, /== host-run: check package meta/);
  assert.doesNotMatch(r.stderr, /check-package-meta \(tool\)/);
  assert.match(`${r.stdout}${r.stderr}`, /repack-published/);
});
