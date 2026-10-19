import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { classify, compareVersions, nextRevision, npmParity } from '../npm-parity.mjs';
import { compareTarballs } from '../tarball-parity.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');

function workdir() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'homescoop-npm-parity-')));
}

function pack(dir, { name = '@ai-ecoverse/wasm-xz', version = '5.8.4-1', files = {}, modes = {}, mtime = 499162500, gzip = '-6' } = {}) {
  const src = mkdtempSync(join(dir, 'src-'));
  const pkg = join(src, 'package');
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  const all = { 'package.json': JSON.stringify({ name, version }), 'README.md': 'xz 5.8.4\n', 'bin/xz': '#!/usr/bin/env node\n', 'bin/xz.wasm': 'wasm', ...files };
  for (const [rel, body] of Object.entries(all)) {
    if (body === null) continue;
    mkdirSync(dirname(join(pkg, rel)), { recursive: true });
    writeFileSync(join(pkg, rel), body);
    chmodSync(join(pkg, rel), modes[rel] ?? (rel.startsWith('bin/') ? 0o755 : 0o644));
    utimesSync(join(pkg, rel), mtime, mtime);
  }
  const tgz = join(dir, `${Math.random().toString(36).slice(2)}.tgz`);
  const r = spawnSync('bash', ['-c', `COPYFILE_DISABLE=1 tar -cf - -C "${src}" package | gzip ${gzip} -n > "${tgz}"`]);
  assert.equal(r.status, 0, String(r.stderr));
  return tgz;
}

test('compareVersions orders packaging revisions as semver does', () => {
  for (const [a, b, want] of [
    ['1.0.8-2', '1.0.8-10', -1],
    ['3.54.0-1', '3.54.0-3', -1],
    ['3.54.0-3', '3.54.0-3', 0],
    ['2025.9.30-29', '2025.9.30-28', 1],
    ['5.42.0-12', '5.43.0-1', -1],
    ['1.2.3-1', '1.2.3', -1],
    ['2.9.0-post0.2', '2.9.0-post0.10', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['1.0.0-1.1', '1.0.0-1', 1],
  ]) {
    assert.equal(compareVersions(a, b), want, `${a} vs ${b}`);
    assert.equal(compareVersions(b, a), want ? -want : 0, `${b} vs ${a}`);
  }
  assert.throws(() => compareVersions('2.23-1', '2.23.0-1'), /not a semver version: 2\.23-1/);
});

test('nextRevision bumps the -N packaging revision', () => {
  assert.equal(nextRevision('5.42.0-12'), '5.42.0-13');
  assert.equal(nextRevision('1.0.8-2'), '1.0.8-3');
  assert.equal(nextRevision('2.9.0-post0.2'), null);
});

test('classify: behind latest, published, or new', () => {
  const reg = { versions: ['3.54.0-1', '3.54.0-2', '3.54.0-3'], latest: '3.54.0-3' };
  assert.deepEqual(classify('3.54.0-1', reg), { kind: 'behind', latest: '3.54.0-3', published: true });
  assert.deepEqual(classify('3.53.9-7', reg), { kind: 'behind', latest: '3.54.0-3', published: false });
  assert.deepEqual(classify('3.54.0-3', reg), { kind: 'published', latest: '3.54.0-3' });
  assert.equal(classify('3.54.0-4', reg).kind, 'new');
  assert.equal(classify('3.55.0-1', reg).kind, 'new');
  assert.deepEqual(classify('1.0.0-1', null), { kind: 'new', why: 'not on npm' });
});

test('npmParity: #402, a build of a version older than latest fails, whatever --drift says', () => {
  const dir = workdir();
  try {
    const tgz = readFileSync(pack(dir, { name: '@ai-ecoverse/wasm-sqlite3', version: '3.54.0-1' }));
    const registry = () => ({ versions: ['3.54.0-1', '3.54.0-3'], latest: '3.54.0-3' });
    const pack_ = () => assert.fail('nothing to download for a stale build');
    for (const drift of ['warn', 'fail']) {
      const r = npmParity(tgz, { drift, registry, pack: pack_ });
      assert.equal(r.verdict, 'behind');
      assert.equal(r.level, 'error');
      assert.match(r.message, /@ai-ecoverse\/wasm-sqlite3@3\.54\.0-1 sorts below npm latest 3\.54\.0-3 \(and is already on npm\): this build is behind main/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('npmParity: #497, the same version with other contents is drift; warn in warn mode, error in fail mode', () => {
  const dir = workdir();
  try {
    const published = readFileSync(pack(dir, { files: { 'README.md': 'xz 5.8.1\n' }, modes: { 'bin/xz': 0o644 } }));
    const built = readFileSync(pack(dir));
    const registry = () => ({ versions: ['5.8.4-1'], latest: '5.8.4-1' });
    const asked = [];
    const pack_ = (spec) => (asked.push(spec), published);
    const w = npmParity(built, { drift: 'warn', registry, pack: pack_ });
    assert.deepEqual(asked, ['@ai-ecoverse/wasm-xz@5.8.4-1']);
    assert.equal(w.verdict, 'drift');
    assert.equal(w.level, 'warning');
    assert.match(w.message, /@ai-ecoverse\/wasm-xz@5\.8\.4-1 is on npm with different contents \(2 entries: README\.md, bin\/xz\), so this build would never ship: bump the packaging revision to 5\.8\.4-2 or revert the change/);
    assert.deepEqual(
      w.diffs.map((d) => d.path),
      ['package/README.md', 'package/bin/xz'],
    );
    assert.match(w.details.join('\n'), /package\/bin\/xz: mode 0644 in npm, 0755 in build/);
    assert.match(w.details.join('\n'), /package\/README\.md: content 9 B \w+ in npm, 9 B \w+ in build/);
    const f = npmParity(built, { drift: 'fail', registry, pack: pack_ });
    assert.equal(f.verdict, 'drift');
    assert.equal(f.level, 'error');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('npmParity: the same entries pass, even when the tarball bytes differ (mtime, gzip level)', () => {
  const dir = workdir();
  try {
    const a = readFileSync(pack(dir));
    const b = readFileSync(pack(dir, { gzip: '-9' }));
    const registry = () => ({ versions: ['5.8.4-1'], latest: '5.8.4-1' });
    const same = npmParity(a, { drift: 'fail', registry, pack: () => a });
    assert.equal(same.verdict, 'same');
    assert.equal(same.level, 'notice');
    assert.match(same.message, /is on npm with the same contents \(byte-identical tarball\); nothing to publish/);
    const equal = npmParity(b, { drift: 'fail', registry, pack: () => a });
    assert.equal(equal.verdict, 'same');
    assert.doesNotMatch(equal.message, /byte-identical/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('npmParity: a version above latest, or a package npm does not know, is a new release', () => {
  const dir = workdir();
  try {
    const tgz = readFileSync(pack(dir, { version: '5.8.4-2' }));
    const never = () => assert.fail('nothing to download for a new release');
    const r = npmParity(tgz, { drift: 'fail', registry: () => ({ versions: ['5.8.4-1'], latest: '5.8.4-1' }), pack: never });
    assert.equal(r.verdict, 'new');
    assert.match(r.message, /@ai-ecoverse\/wasm-xz@5\.8\.4-2: a new release \(not on npm, above latest 5\.8\.4-1\)/);
    assert.equal(npmParity(tgz, { registry: () => null, pack: never }).verdict, 'new');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compareTarballs names added, removed, mode, link and content differences', () => {
  const dir = workdir();
  try {
    const a = readFileSync(pack(dir, { files: { 'old.txt': 'x' } }));
    const b = readFileSync(pack(dir, { files: { 'new.txt': 'y', 'bin/xz.wasm': 'wasm2' }, modes: { 'README.md': 0o600 } }));
    const r = compareTarballs(a, b, { labels: ['hosted', 'pool'] });
    assert.equal(r.same, false);
    assert.deepEqual(
      r.diffs.map((d) => `${d.path}: ${d.what.replace(/ [0-9a-f]{12} /g, ' <sha> ')}`),
      [
        'package/README.md: mode 0644 in hosted, 0600 in pool',
        'package/bin/xz.wasm: content 4 B <sha> in hosted, 5 B <sha> in pool',
        'package/new.txt: only in pool',
        'package/old.txt: only in hosted',
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fakeNpm(dir, { view, published }) {
  const bin = join(dir, 'fake-npm');
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
echo "$*" >> "${join(dir, 'npm.log')}"
case "$1" in
  view) ${view} ;;
  pack) cp "${published}" "$4/published.tgz" ;;
esac
`,
  );
  chmodSync(bin, 0o755);
  return bin;
}

function cli(dir, tgz, npm, ...args) {
  const summary = join(dir, 'summary.md');
  rmSync(summary, { force: true });
  const r = spawnSync(process.execPath, [join(scripts, 'npm-parity.mjs'), tgz, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HOMESCOOP_NPM: npm, HOMESCOOP_NPM_RETRY_S: '0', GITHUB_STEP_SUMMARY: summary },
  });
  let s = '';
  try {
    s = readFileSync(summary, 'utf8');
  } catch {}
  return { ...r, summary: s };
}

test('npm-parity CLI: annotations, summary line, json and exit codes against a registry', () => {
  const dir = workdir();
  try {
    const published = pack(dir, { files: { 'README.md': 'xz 5.8.1\n' } });
    const built = pack(dir);
    const npm = fakeNpm(dir, { view: `echo '{"versions":["5.8.3-1","5.8.4-1"],"dist-tags":{"latest":"5.8.4-1"}}'`, published });
    const w = cli(dir, built, npm, '--json', join(dir, 'out', 'r.json'));
    assert.equal(w.status, 0, w.stderr);
    assert.match(w.stdout, /^::warning::@ai-ecoverse\/wasm-xz@5\.8\.4-1 is on npm with different contents \(1 entry: README\.md\)/);
    assert.match(w.summary, /^- npm-parity drift: /);
    assert.equal(JSON.parse(readFileSync(join(dir, 'out', 'r.json'), 'utf8')).verdict, 'drift');
    assert.match(readFileSync(join(dir, 'npm.log'), 'utf8'), /^view @ai-ecoverse\/wasm-xz versions dist-tags --json\npack @ai-ecoverse\/wasm-xz@5\.8\.4-1 --pack-destination /);
    const f = cli(dir, built, npm, '--drift', 'fail');
    assert.equal(f.status, 1);
    assert.match(f.stdout, /^::error::@ai-ecoverse\/wasm-xz@5\.8\.4-1 is on npm with different contents/);
    const old = cli(dir, pack(dir, { version: '5.8.3-1' }), npm);
    assert.equal(old.status, 1);
    assert.match(old.stdout, /^::error::@ai-ecoverse\/wasm-xz@5\.8\.3-1 sorts below npm latest 5\.8\.4-1/);
    assert.equal(cli(dir, pack(dir, { version: '5.8.4-2' }), npm, '--drift', 'fail').status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('npm-parity CLI: an unknown package is new; a registry that does not answer fails closed', () => {
  const dir = workdir();
  try {
    const built = pack(dir);
    const missing = fakeNpm(dir, { view: `echo 'npm error code E404' >&2; exit 1`, published: built });
    const r = cli(dir, built, missing);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /^::notice::@ai-ecoverse\/wasm-xz@5\.8\.4-1: a new release \(not on npm\)/);
    const down = fakeNpm(dir, { view: `echo 'npm error code ETIMEDOUT' >&2; exit 1`, published: built });
    const d = cli(dir, built, down);
    assert.equal(d.status, 1);
    assert.match(d.stdout, /^::error::npm-parity: npm view @ai-ecoverse\/wasm-xz failed: npm error code ETIMEDOUT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('tarball-parity CLI: exit 0 for the same entries, 1 with the list otherwise', () => {
  const dir = workdir();
  try {
    const a = pack(dir);
    const b = pack(dir, { gzip: '-1' });
    const c = pack(dir, { modes: { 'bin/xz': 0o644 } });
    const run = (...args) => spawnSync(process.execPath, [join(scripts, 'tarball-parity.mjs'), ...args], { encoding: 'utf8' });
    const same = run(a, b, '--labels', 'hosted,pool');
    assert.equal(same.status, 0, same.stdout);
    assert.match(same.stdout, /every entry is the same \(the tarballs' bytes differ, their entries do not\)/);
    const diff = run(a, c, '--labels', 'hosted,pool');
    assert.equal(diff.status, 1);
    assert.match(diff.stdout, /tarball-parity: 1 entry differs:\n  package\/bin\/xz: mode 0755 in hosted, 0644 in pool/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a dashed upstream (ImageMagick 7.1.2-34) goes -1 … -9, then -9.1, -9.2, …, and the next upstream sorts above (docs/versioning.md)', () => {
  assert.equal(compareVersions('7.1.2-34-10', '7.1.2-34-9'), -1, '34-10 is one alphanumeric identifier: it sorts below 34-9');
  assert.equal(compareVersions('7.1.2-34-9.1', '7.1.2-34-9'), 1);
  assert.equal(compareVersions('7.1.2-34-9.2', '7.1.2-34-9.1'), 1);
  assert.equal(compareVersions('7.1.2-34-9.10', '7.1.2-34-9.9'), 1);
  assert.equal(compareVersions('7.1.2-35-1', '7.1.2-34-9.12'), 1);
  assert.equal(compareVersions('7.1.2-34-2', '7.1.2-34-1'), 1);
  assert.equal(nextRevision('7.1.2-34-8'), '7.1.2-34-9');
  assert.equal(nextRevision('7.1.2-34-9'), '7.1.2-34-9.1');
  assert.equal(nextRevision('7.1.2-34-9.1'), '7.1.2-34-9.2');
  assert.equal(nextRevision('7.1.2-34-9.9'), '7.1.2-34-9.10');
  assert.equal(classify('7.1.2-34-9.1', { latest: '7.1.2-34-9', versions: ['7.1.2-34-9'] }).kind, 'new');
  assert.equal(classify('7.1.2-34-10', { latest: '7.1.2-34-9', versions: ['7.1.2-34-9'] }).kind, 'behind');
});
