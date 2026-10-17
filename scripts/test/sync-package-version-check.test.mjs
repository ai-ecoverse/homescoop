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

const bare = (version, homescoop = '') => `{
  "name": "@ai-ecoverse/wasm-xxd",
  "version": "${version}",
  "description": "xxd for wasm / slicc"${homescoop}
}
`;

function check(recipeVersion, pkg, args = ['--check']) {
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
    const r = spawnSync(process.execPath, [join(root, 'scripts', 'sync-package-version.mjs'), 'xxd', ...args], {
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

test('--check counts a missing homescoop.upstream as drift, and --write adds it', () => {
  for (const pkg of [bare('9.2.1186-1'), bare('9.2.1186-1', ',\n  "homescoop": { "recipe": "xxd" }')]) {
    const r = check('9.2.1186', pkg);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /disagrees with recipe\.yaml: homescoop\.upstream is \(none\), but recipe\.yaml version is 9\.2\.1186\n$/);
    const w = check('9.2.1186', pkg, ['--write']);
    assert.equal(w.status, 0, w.stderr);
    assert.equal(JSON.parse(w.after).homescoop.upstream, '9.2.1186');
    assert.equal(JSON.parse(w.after).version, '9.2.1186-1');
  }
});

test('a PEP 440 post-release maps to X.Y.Z-postN.<rev>, the shape on npm', () => {
  const same = check('2.9.0.post0', xxdPkg('2.9.0-post0.2', '2.9.0.post0'));
  assert.equal(same.status, 0, same.stderr);
  assert.equal(same.stdout, '2.9.0-post0.2\n');

  const moved = check('2.9.0.post1', xxdPkg('2.9.0-post0.2', '2.9.0.post0'));
  assert.equal(moved.status, 1);
  assert.match(moved.stderr, /version is 2\.9\.0-post0\.2, but recipe\.yaml 2\.9\.0\.post1 gives 2\.9\.0-post1\.1;/);
  const written = check('2.9.0.post1', xxdPkg('2.9.0-post0.2', '2.9.0.post0'), ['--write']);
  assert.equal(written.stdout, '2.9.0-post1.1\n');
  assert.equal(JSON.parse(written.after).version, '2.9.0-post1.1');

  assert.equal(check('2.9.0.post0', xxdPkg('2.9.0-1', '2.9.0')).stderr.match(/gives (\S+)/)[1], '2.9.0-post0.1;');
  assert.equal(check('2.9.post3', xxdPkg('2.9.0-post3.4', '2.9.post3')).stdout, '2.9.0-post3.4\n');
  assert.equal(check('2.9.0.post0', xxdPkg('2.9.0-post0.0', '2.9.0.post0')).status, 1);
  assert.equal(check('2.9.1', xxdPkg('2.9.0-post0.2', '2.9.0.post0'), ['--write']).stdout, '2.9.1-1\n');
});

const goPkg = (version, upstream, go) => `{
  "name": "@ai-ecoverse/wasm-xxd",
  "version": "${version}",
  "description": "xxd for wasm / slicc",
  "homescoop": { "recipe": "xxd", "upstream": "${upstream}" },
  "slicc": {
    "abi": "wasi",
    "go": {
      "version": "${go}",
      "std": [{ "target": "wasip1/wasm", "dir": "goroot/pkg/wasip1_wasm" }]
    }
  }
}
`;

test('slicc.go.version follows the recipe version: --check names the drift, --write fixes it in place (homescoop#746)', () => {
  const ok = check('1.27.2', goPkg('1.27.2-1', '1.27.2', 'go1.27.2'));
  assert.equal(ok.status, 0, ok.stderr);
  const stale = check('1.27.2', goPkg('1.27.2-1', '1.27.2', 'go1.26.5'));
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /disagrees with recipe\.yaml: slicc\.go\.version is go1\.26\.5, but recipe\.yaml version is 1\.27\.2\n$/);
  assert.equal(stale.after, goPkg('1.27.2-1', '1.27.2', 'go1.26.5'));
  const w = check('1.27.2', goPkg('1.27.2-1', '1.27.2', 'go1.26.5'), ['--write']);
  assert.equal(w.status, 0, w.stderr);
  assert.equal(w.after, goPkg('1.27.2-1', '1.27.2', 'go1.27.2'));
  const bump = check('1.27.2', goPkg('1.26.5-2', '1.26.5', 'go1.26.5'), ['--write']);
  assert.equal(bump.status, 0, bump.stderr);
  assert.equal(bump.after, goPkg('1.27.2-1', '1.27.2', 'go1.27.2'));
  assert.equal(check('9.2.1186', xxdPkg('9.2.1186-1', '9.2.1186'), ['--write']).after, xxdPkg('9.2.1186-1', '9.2.1186'));
});
