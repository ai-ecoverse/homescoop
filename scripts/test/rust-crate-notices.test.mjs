import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homescoopPatchedCratePath, licenceFiles, treeCrates } from '../rust-crate-notices-lib.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const noticeScript = join(scripts, 'rust-crate-notices.mjs');
const checkScript = join(scripts, 'check-rust-notices.mjs');
const pinsPath = join(scripts, 'crate-licences.json');

function crateWith(root, name, files) {
  const dir = join(root, name);
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return join(dir, 'Cargo.toml');
}

function runNotices(meta, tree) {
  return spawnSync('node', [noticeScript, meta, tree], { encoding: 'utf8' });
}

function runCheck(notices, tree, lock) {
  return spawnSync('node', [checkScript, notices, tree, lock], { encoding: 'utf8' });
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
  const r = runNotices(join(root, 'meta.json'), join(root, 'tree.txt'));
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
  const r = runNotices(join(root, 'meta.json'), join(root, 'tree.txt'));
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
  const r = runNotices(join(root, 'meta.json'), join(root, 'tree.txt'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no licence file in no-pin-crate 9\.9\.9/);
});

test('homescoopPatchedCratePath matches homescoop-crates/<name>-<version> only', () => {
  assert.equal(homescoopPatchedCratePath('cargo-util', '0.2.32', '/work/uv/homescoop-crates/cargo-util-0.2.32/Cargo.toml'), true);
  assert.equal(homescoopPatchedCratePath('cargo-util', '0.2.32', '/work/uv/homescoop-crates/cargo-util-0.2.31'), false);
  assert.equal(homescoopPatchedCratePath('wasix-command', '0.1.0', '/work/uv/homescoop-crates/wasix-command'), false);
  assert.equal(homescoopPatchedCratePath('uv-fs', '0.13.7', '/work/uv/crates/uv-fs'), false);
});

test('treeCrates includes homescoop-crates/<name>-<version> path deps and skips other paths', () => {
  const tree = [
    'uv v0.13.7 (/work/uv/crates/uv)',
    'cargo-util v0.2.32 (/work/uv/homescoop-crates/cargo-util-0.2.32)',
    'hyper-util v0.1.21 (/work/uv/homescoop-crates/hyper-util-0.1.21)',
    'wasix-command v0.1.0 (/work/uv/homescoop-crates/wasix-command)',
    'uv-fs v0.13.7 (/work/uv/crates/uv-fs)',
    'adler2 v2.0.1',
    'reqsign-aws-core v3.2.0',
  ].join('\n');
  assert.deepEqual([...treeCrates(tree)].sort(), [
    'adler2 2.0.1',
    'cargo-util 0.2.32',
    'hyper-util 0.1.21',
    'reqsign-aws-core 3.2.0',
  ]);
});

test('a homescoop-crates path crate gets a crates.io section from its patched directory', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rust-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const patched = join(root, 'homescoop-crates', 'cargo-util-0.2.32');
  mkdirSync(patched, { recursive: true });
  writeFileSync(join(patched, 'Cargo.toml'), '');
  writeFileSync(join(patched, 'LICENSE-MIT'), 'cargo-util mit');
  writeFileSync(join(patched, 'LICENSE-APACHE'), 'cargo-util apache');
  const packages = [
    { name: 'adler2', version: '2.0.1', license: '0BSD OR MIT OR Apache-2.0', source: 'registry+https://example.test', manifest_path: crateWith(root, 'adler2', { 'Cargo.toml': '', 'LICENSE-0BSD': 'adler' }) },
    { name: 'cargo-util', version: '0.2.32', license: 'MIT OR Apache-2.0', source: null, manifest_path: join(patched, 'Cargo.toml') },
    { name: 'uv', version: '0.13.7', license: 'MIT OR Apache-2.0', source: null, manifest_path: join(root, 'crates', 'uv', 'Cargo.toml') },
  ];
  mkdirSync(join(root, 'crates', 'uv'), { recursive: true });
  writeFileSync(join(root, 'crates', 'uv', 'Cargo.toml'), '');
  writeFileSync(join(root, 'meta.json'), JSON.stringify({ packages }));
  writeFileSync(join(root, 'tree.txt'), [
    'uv v0.13.7 (/work/uv/crates/uv)',
    'adler2 v2.0.1',
    `cargo-util v0.2.32 (${patched})`,
  ].join('\n') + '\n');
  const r = runNotices(join(root, 'meta.json'), join(root, 'tree.txt'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /## cargo-util 0\.2\.32 \(MIT OR Apache-2\.0\)\n\nSource: https:\/\/crates\.io\/crates\/cargo-util\/0\.2\.32\n/);
  assert.match(r.stdout, /cargo-util apache/);
  assert.match(r.stdout, /cargo-util mit/);
  assert.match(r.stdout, /## adler2 2\.0\.1/);
  assert.doesNotMatch(r.stdout, /## uv /);
});

test('registry-only notices for a ripgrep-shaped tree stay the same with and without path lines skipped', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rust-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packages = [
    { name: 'aho-corasick', version: '1.1.3', license: 'MIT OR Unlicense', source: 'registry+https://example.test', manifest_path: crateWith(root, 'aho-corasick', { 'Cargo.toml': '', 'LICENSE-MIT': 'aho mit' }) },
    { name: 'memchr', version: '2.7.4', license: 'MIT OR Unlicense', source: 'registry+https://example.test', manifest_path: crateWith(root, 'memchr', { 'Cargo.toml': '', 'LICENSE-MIT': 'memchr mit' }) },
    { name: 'ripgrep', version: '15.2.0', license: 'MIT OR Unlicense', source: null, manifest_path: join(root, 'ripgrep', 'Cargo.toml') },
  ];
  mkdirSync(join(root, 'ripgrep'), { recursive: true });
  writeFileSync(join(root, 'ripgrep', 'Cargo.toml'), '');
  writeFileSync(join(root, 'meta.json'), JSON.stringify({ packages }));
  writeFileSync(join(root, 'tree.txt'), 'ripgrep v15.2.0 (/work/ripgrep)\naho-corasick v1.1.3\nmemchr v2.7.4\n');
  const r = runNotices(join(root, 'meta.json'), join(root, 'tree.txt'));
  assert.equal(r.status, 0, r.stderr);
  const want = [
    '',
    '## aho-corasick 1.1.3 (MIT OR Unlicense)',
    '',
    'Source: https://crates.io/crates/aho-corasick/1.1.3',
    '',
    '```text',
    'aho mit',
    '```',
    '',
    '## memchr 2.7.4 (MIT OR Unlicense)',
    '',
    'Source: https://crates.io/crates/memchr/2.7.4',
    '',
    '```text',
    'memchr mit',
    '```',
    '',
  ].join('\n');
  assert.equal(r.stdout, want);
});

test('check-rust-notices fails when a linked homescoop-crates crate has no notices entry', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rust-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const notices = [
    '# Third-party notices',
    '',
    '## adler2 2.0.1 (0BSD OR MIT OR Apache-2.0)',
    '',
    'Source: https://crates.io/crates/adler2/2.0.1',
    '',
  ].join('\n');
  const tree = [
    'uv v0.13.7 (/work/uv/crates/uv)',
    'adler2 v2.0.1',
    'cargo-util v0.2.32 (/work/uv/homescoop-crates/cargo-util-0.2.32)',
  ].join('\n') + '\n';
  const lock = [
    '[[package]]',
    'name = "adler2"',
    'version = "2.0.1"',
    '',
    '[[package]]',
    'name = "cargo-util"',
    'version = "0.2.32"',
    '',
  ].join('\n');
  writeFileSync(join(root, 'notices.md'), notices);
  writeFileSync(join(root, 'tree.txt'), tree);
  writeFileSync(join(root, 'Cargo.lock'), lock);
  const r = runCheck(join(root, 'notices.md'), join(root, 'tree.txt'), join(root, 'Cargo.lock'));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /linked but not in the notices: cargo-util 0\.2\.32/);
});

test('published wasi-uv 0.13.7-1 notices omit the patched crates that cargo tree links', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'rust-notices-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const notices = [
    '# Third-party notices',
    '',
    '## adler2 2.0.1 (0BSD OR MIT OR Apache-2.0)',
    '',
    '## reqsign-aws-core 3.2.0 (Apache-2.0)',
    '',
  ].join('\n');
  const tree = [
    'uv v0.13.7 (/work/uv/crates/uv)',
    'adler2 v2.0.1',
    'cargo-util v0.2.32 (/work/uv/homescoop-crates/cargo-util-0.2.32)',
    'hyper-util v0.1.21 (/work/uv/homescoop-crates/hyper-util-0.1.21)',
    'reqsign-aws-core v3.2.0',
  ].join('\n') + '\n';
  const lock = [
    '[[package]]',
    'name = "adler2"',
    'version = "2.0.1"',
    '',
    '[[package]]',
    'name = "cargo-util"',
    'version = "0.2.32"',
    '',
    '[[package]]',
    'name = "hyper-util"',
    'version = "0.1.21"',
    '',
    '[[package]]',
    'name = "reqsign-aws-core"',
    'version = "3.2.0"',
    '',
  ].join('\n');
  writeFileSync(join(root, 'notices.md'), notices);
  writeFileSync(join(root, 'tree.txt'), tree);
  writeFileSync(join(root, 'Cargo.lock'), lock);
  const r = runCheck(join(root, 'notices.md'), join(root, 'tree.txt'), join(root, 'Cargo.lock'));
  assert.notEqual(r.status, 0, '0.13.7-1-shaped notices must fail once path crates are linked');
  assert.match(r.stderr, /cargo-util 0\.2\.32/);
  assert.match(r.stderr, /hyper-util 0\.1\.21/);
});
