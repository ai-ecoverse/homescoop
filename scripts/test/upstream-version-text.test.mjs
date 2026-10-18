import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadAllow, rewriteUpstream, staleVersions } from '../upstream-version-text.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const allow = loadAllow();

function fixture(name, { recipeVersion, summary, pkg, readme }) {
  const root = mkdtempSync(join(tmpdir(), 'homescoop-uvt-'));
  mkdirSync(join(root, 'scripts'));
  for (const f of ['sync-package-version.mjs', 'read-recipe.mjs', 'upstream-version-text.mjs', 'npm-tag.mjs', 'package-meta-versions.json', 'check-package-meta.mjs']) {
    copyFileSync(join(scripts, f), join(root, 'scripts', f));
  }
  const dir = join(root, 'packages', name);
  mkdirSync(join(dir, 'package'), { recursive: true });
  writeFileSync(join(dir, 'recipe.yaml'), `name: ${name}\nbuilder: host\nversion: "${recipeVersion}"\nsummary: "${summary}"\n`);
  writeFileSync(join(dir, 'package', 'package.json'), pkg);
  writeFileSync(join(dir, 'package', 'README.md'), readme);
  const files = {
    recipe: join(dir, 'recipe.yaml'),
    pkg: join(dir, 'package', 'package.json'),
    readme: join(dir, 'package', 'README.md'),
  };
  const node = (script, ...args) => spawnSync(process.execPath, [join(root, 'scripts', script), ...args], { encoding: 'utf8', cwd: root });
  const read = () => Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(p, 'utf8')]));
  return { root, node, read, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const curlPkg = (version, upstream) => `{
  "name": "@ai-ecoverse/wasm-curl",
  "version": "${version}",
  "description": "curl 8.22 + libcurl for wasm / slicc",
  "repository": { "type": "git", "url": "git+https://github.com/ai-ecoverse/homescoop.git", "directory": "packages/curl/package" },
  "files": ["README.md", "LICENSE", "bin"],
  "homescoop": { "recipe": "curl", "upstream": "${upstream}" }
}
`;

test('a minor bump rewrites the major.minor abbreviation of the previous upstream', () => {
  const text = 'curl 8.22 + libcurl. Revision 8.22.0-4 shipped. Since 8.22 it is fast. Needs slicc-kernel 8.22.';
  const r = rewriteUpstream(text, '8.22.0', '8.23.0', { allow, name: 'curl' });
  assert.equal(r.text, 'curl 8.23 + libcurl. Revision 8.22.0-4 shipped. Since 8.22 it is fast. Needs slicc-kernel 8.22.');
  assert.deepEqual(r.changes.map((c) => `${c.from}→${c.to}`), ['8.22→8.23']);
  assert.deepEqual(r.kept.map((k) => k.reason), ['historical "since"', 'lead "slicc-kernel"']);
  assert.deepEqual(staleVersions(r.text, '8.23.0', { allow, name: 'curl' }), []);
});

test('a patch bump leaves the abbreviation alone and rewrites the full version', () => {
  const r = rewriteUpstream('curl 8.22 (8.22.0)', '8.22.0', '8.22.1', { allow, name: 'curl' });
  assert.equal(r.text, 'curl 8.22 (8.22.1)');
});

test('a major bump maps the abbreviation onto the padded new upstream', () => {
  const r = rewriteUpstream('tool 4.9 and 4.9.2', '4.9.2', '5', { allow, name: 'tool' });
  assert.equal(r.text, 'tool 5.0 and 5');
});

test('the previous abbreviation alone is stale to the check', () => {
  assert.deepEqual(staleVersions('curl 8.22 + libcurl', '8.23.0', { allow, name: 'curl' }).map((s) => s.version), ['8.22']);
});

test('sync --write on a Renovate-shaped curl bump leaves no drift', () => {
  const fx = fixture('curl', {
    recipeVersion: '8.23.0',
    summary: 'curl 8.22 + libcurl for slicc',
    pkg: curlPkg('8.22.0-4', '8.22.0'),
    readme: 'curl 8.22.0 and static libcurl.\n',
  });
  try {
    assert.equal(fx.node('check-package-meta.mjs', '--drift', 'curl').status, 1);
    const s = fx.node('sync-package-version.mjs', 'curl', '--write');
    assert.equal(s.status, 0, s.stderr);
    assert.equal(s.stdout, '8.23.0-1\n');
    const after = fx.read();
    assert.match(after.recipe, /summary: "curl 8\.23 \+ libcurl for slicc"/);
    assert.equal(after.pkg, curlPkg('8.23.0-1', '8.23.0').replace('curl 8.22 +', 'curl 8.23 +'));
    assert.equal(after.readme, 'curl 8.23.0 and static libcurl.\n');
    const c = fx.node('check-package-meta.mjs', '--drift', 'curl');
    assert.equal(c.status, 0, c.stderr);
  } finally {
    fx.cleanup();
  }
});

test('sync --write repairs a stale homescoop.upstream when the version already matches', () => {
  const fx = fixture('curl', {
    recipeVersion: '8.23.0',
    summary: 'curl 8.22 + libcurl for slicc',
    pkg: curlPkg('8.23.0-1', '8.22.0'),
    readme: 'curl 8.22.0 and static libcurl.\n',
  });
  try {
    const before = fx.node('check-package-meta.mjs', '--drift', 'curl');
    assert.equal(before.status, 1);
    assert.match(before.stderr, /homescoop\.upstream "8\.22\.0" != recipe version 8\.23\.0/);
    const s = fx.node('sync-package-version.mjs', 'curl', '--write');
    assert.equal(s.status, 0, s.stderr);
    assert.equal(s.stdout, '8.23.0-1\n');
    assert.match(s.stderr, /homescoop\.upstream 8\.22\.0 → 8\.23\.0/);
    const after = fx.read();
    assert.equal(after.pkg, curlPkg('8.23.0-1', '8.23.0').replace('curl 8.22 +', 'curl 8.23 +'));
    assert.equal(after.readme, 'curl 8.23.0 and static libcurl.\n');
    const c = fx.node('check-package-meta.mjs', '--drift', 'curl');
    assert.equal(c.status, 0, c.stderr);
  } finally {
    fx.cleanup();
  }
});

test('sync --write leaves allowed spellings and padded upstreams alone', () => {
  for (const [name, recipeVersion, upstream, text] of [
    ['wasix-openssh', '10.6.0', '10.6p1', 'OpenSSH 10.6p1 client'],
    ['zip', '3.0.0', '3.0', 'Info-ZIP zip 3.0'],
  ]) {
    const pkg = `{\n  "name": "@ai-ecoverse/${name}",\n  "version": "${recipeVersion}-1",\n  "description": "${text}",\n  "repository": { "type": "git", "url": "git+https://github.com/ai-ecoverse/homescoop.git", "directory": "packages/${name}/package" },\n  "homescoop": { "recipe": "${name}", "upstream": "${upstream}" }\n}\n`;
    const fx = fixture(name, { recipeVersion, summary: text, pkg, readme: `${text}.\n` });
    try {
      const before = fx.read();
      const s = fx.node('sync-package-version.mjs', name, '--write');
      assert.equal(s.status, 0, s.stderr);
      assert.equal(s.stderr, '', `${name}: ${s.stderr}`);
      assert.deepEqual(fx.read(), before, name);
      const c = fx.node('check-package-meta.mjs', '--drift', name);
      assert.equal(c.status, 0, c.stderr);
    } finally {
      fx.cleanup();
    }
  }
});
