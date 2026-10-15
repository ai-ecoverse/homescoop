import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');

const xxdPkg = (version, upstream) => `{
  "name": "@ai-ecoverse/wasm-xxd",
  "version": "${version}",
  "description": "xxd for wasm / slicc",
  "homescoop": { "recipe": "xxd", "upstream": "${upstream}" }
}
`;

function check(recipeVersion, pkg) {
  const root = mkdtempSync(join(tmpdir(), 'homescoop-check-'));
  try {
    mkdirSync(join(root, 'scripts'));
    for (const f of ['sync-package-version.mjs', 'read-recipe.mjs', 'upstream-version-text.mjs', 'package-meta-versions.json']) {
      copyFileSync(join(scripts, f), join(root, 'scripts', f));
    }
    const dir = join(root, 'packages', 'xxd');
    mkdirSync(join(dir, 'package'), { recursive: true });
    writeFileSync(join(dir, 'recipe.yaml'), `name: xxd\nbuilder: host\nversion: "${recipeVersion}"\nsummary: "xxd for slicc"\n`);
    writeFileSync(join(dir, 'package', 'package.json'), pkg);
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'sync-package-version.mjs'), 'xxd', '--check'], {
      encoding: 'utf8',
      cwd: root,
    });
    return { ...r, after: readFileSync(join(dir, 'package', 'package.json'), 'utf8') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('--check passes a package.json that matches its recipe and writes nothing', () => {
  const r = check('9.2.1186', xxdPkg('9.2.1186-1', '9.2.1186'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '9.2.1186-1\n');
  assert.equal(r.after, xxdPkg('9.2.1186-1', '9.2.1186'));
});

test('--check accepts a packaging revision bump on the same upstream', () => {
  const r = check('9.2.1186', xxdPkg('9.2.1186-4', '9.2.1186'));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '9.2.1186-4\n');
});

test('--check names both versions when the version base drifts, and writes nothing', () => {
  const r = check('9.2.1192', xxdPkg('9.2.1186-1', '9.2.1192'));
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /xxd package\/package\.json disagrees with recipe\.yaml: version is 9\.2\.1186-1, but recipe\.yaml 9\.2\.1192 gives 9\.2\.1192-1\n$/);
  assert.equal(r.after, xxdPkg('9.2.1186-1', '9.2.1192'));
});

test('--check names both values when homescoop.upstream drifts', () => {
  const r = check('9.2.1186', xxdPkg('9.2.1186-1', '9.2.1180'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /homescoop\.upstream is 9\.2\.1180, but recipe\.yaml version is 9\.2\.1186\n$/);
});

test('--check reports both drifts in one line', () => {
  const r = check('9.2.1192', xxdPkg('9.2.1186-1', '9.2.1186'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /version is 9\.2\.1186-1, but recipe\.yaml 9\.2\.1192 gives 9\.2\.1192-1; homescoop\.upstream is 9\.2\.1186, but recipe\.yaml version is 9\.2\.1192\n$/);
});
