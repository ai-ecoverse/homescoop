import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'git+https://github.com/ai-ecoverse/homescoop.git';

function check(name, { builder = 'host', repository }) {
  const root = mkdtempSync(join(tmpdir(), 'homescoop-repo-'));
  try {
    mkdirSync(join(root, 'scripts'));
    for (const f of ['check-package-meta.mjs', 'read-recipe.mjs', 'upstream-version-text.mjs', 'package-meta-versions.json']) {
      copyFileSync(join(scripts, f), join(root, 'scripts', f));
    }
    mkdirSync(join(root, 'packages', name, 'package'), { recursive: true });
    writeFileSync(join(root, 'packages', name, 'recipe.yaml'), `name: ${name}\nbuilder: ${builder}\nversion: "1.2.3"\nsummary: "tool"\n`);
    const pkg = { name: `@ai-ecoverse/${name}`, version: '1.2.3-1', description: 'tool', license: 'MIT', ...(repository === undefined ? {} : { repository }), homescoop: { recipe: name, upstream: '1.2.3' } };
    writeFileSync(join(root, 'packages', name, 'package', 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    return spawnSync(process.execPath, [join(root, 'scripts', 'check-package-meta.mjs'), '--drift', name], { encoding: 'utf8', cwd: root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a package.json without repository fails (npm provenance E422)', () => {
  const r = check('tool', {});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /package\.json has no repository .*E422.*"directory": "packages\/tool\/package"/);
});

test('repository.url must be the homescoop repo', () => {
  const r = check('tool', { repository: { type: 'git', url: '', directory: 'packages/tool/package' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /repository\.url is "", not "git\+https:\/\/github\.com\/ai-ecoverse\/homescoop\.git"/);
});

test('repository.directory must be the package directory', () => {
  const r = check('tool', { repository: { type: 'git', url: URL, directory: 'packages/other/package' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /repository\.directory is "packages\/other\/package", not "packages\/tool\/package"/);
});

test('the full repository field passes', () => {
  const r = check('tool', { repository: { type: 'git', url: URL, directory: 'packages/tool/package' } });
  assert.equal(r.status, 0, r.stderr);
});

test('a retired package is not checked', () => {
  const r = check('tool', { builder: 'retired' });
  assert.equal(r.status, 0, r.stderr);
});
