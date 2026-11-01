import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { licenceFiles } from '../rust-crate-notices-lib.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'rust-crate-notices.mjs');

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
