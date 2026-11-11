import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenceFiles } from '../rust-crate-notices-lib.mjs';

const scripts = dirname(fileURLToPath(import.meta.url));
const script = join(scripts, '..', 'rust-crate-notices.mjs');
const pinsPath = join(scripts, '..', 'crate-licences.json');

function crateWith(root, name, files) {
  const dir = join(root, name);
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return join(dir, 'Cargo.toml');
}

test('licenceFiles takes the files inside a LICENSES directory, and leaves other files out', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rust-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  crateWith(root, 'c', { 'Cargo.toml': '', 'README.md': '', 'LICENSES/MIT.txt': 'm', 'LICENSES/Apache-2.0.txt': 'a', 'COPYING': 'c' });
  assert.deepEqual(licenceFiles(join(root, 'c')), ['COPYING', 'LICENSES/Apache-2.0.txt', 'LICENSES/MIT.txt']);
});

test('a crate whose licences sit in a LICENSES directory gets a section with each text', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rust-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packages = [
    { name: 'dirred', version: '0.1.7', license: 'MIT OR Apache-2.0', source: 'registry+https://example.test', manifest_path: crateWith(root, 'dirred', { 'Cargo.toml': '', 'LICENSES/MIT.txt': 'mit text', 'LICENSES/Apache-2.0.txt': 'apache text' }) },
    { name: 'plain', version: '1.0.0', license: 'MIT', source: 'registry+https://example.test', manifest_path: crateWith(root, 'plain', { 'Cargo.toml': '', 'LICENSE': 'plain text' }) },
  ];
  writeFileSync(join(root, 'meta.json'), JSON.stringify({ packages }));
  writeFileSync(join(root, 'tree.txt'), 'app v1.0.0 (/app)\ndirred v0.1.7\nplain v1.0.0\n');
  const r = spawnSync('node', [script, join(root, 'meta.json'), join(root, 'tree.txt')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /## dirred 0\.1\.7 \(MIT OR Apache-2\.0\)[^#]*apache text[^#]*mit text/);
  assert.match(r.stdout, /## plain 1\.0\.0 \(MIT\)[^#]*plain text/);
});

test('grit-pattern-matcher 0.5.2 and grit-util 0.5.2 are pinned to getgrit/gritql LICENSE at their publish commit', () => {
  const pins = JSON.parse(readFileSync(pinsPath, 'utf8'));
  for (const key of ['grit-pattern-matcher 0.5.2', 'grit-util 0.5.2']) {
    const pin = pins[key];
    assert.ok(pin, `${key} must be in scripts/crate-licences.json (Biome 2.6.5; homescoop#2036)`);
    assert.equal(pin.url, 'https://raw.githubusercontent.com/getgrit/gritql/b3e9e54fd5f99a4f7c5e4272b8b671c6919062d0/LICENSE');
    assert.equal(pin.sha256, 'dbc450002a5c7de645e7f35baeffcc1b13f4eced2fd5669d72615303f0ea5825');
  }
});

test('a registry crate with no licence file uses the pin in crate-licences.json', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rust-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packages = [
    { name: 'grit-pattern-matcher', version: '0.5.2', license: 'MIT', source: 'registry+https://example.test', manifest_path: crateWith(root, 'grit-pattern-matcher', { 'Cargo.toml': '' }) },
  ];
  writeFileSync(join(root, 'meta.json'), JSON.stringify({ packages }));
  writeFileSync(join(root, 'tree.txt'), 'app v1.0.0 (/app)\ngrit-pattern-matcher v0.5.2\n');
  const r = spawnSync('node', [script, join(root, 'meta.json'), join(root, 'tree.txt')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /## grit-pattern-matcher 0\.5\.2 \(MIT\)/);
  assert.match(r.stdout, /Copyright \(c\) 2025-present Biome Developers and Contributors/);
  assert.match(r.stdout, /Permission is hereby granted/);
});

test('NEGATIVE: a registry crate with no licence file and no pin fails', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rust-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packages = [
    { name: 'no-pin-crate', version: '9.9.9', license: 'MIT', source: 'registry+https://example.test', manifest_path: crateWith(root, 'no-pin-crate', { 'Cargo.toml': '' }) },
  ];
  writeFileSync(join(root, 'meta.json'), JSON.stringify({ packages }));
  writeFileSync(join(root, 'tree.txt'), 'app v1.0.0 (/app)\nno-pin-crate v9.9.9\n');
  const r = spawnSync('node', [script, join(root, 'meta.json'), join(root, 'tree.txt')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no licence file in no-pin-crate 9\.9\.9/);
});
