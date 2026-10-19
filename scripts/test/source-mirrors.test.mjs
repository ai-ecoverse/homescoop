// source.mirrors: when source.url fails (less's upstream answers the cloud-run
// pool with 403), refresh-recipe-sha.mjs and homescoop_fetch try each mirror
// in order and keep its bytes only when they match the pinned sha256. A
// mirror never sets or refreshes a pin: when the URL or the pin differs from
// the base, the pin comes from the url alone, and a failing url fails.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildView } from '../repack-inputs.mjs';

const execFile = promisify(execFileCb);
const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', RECIPE_SHA_BASE: '', HOMESCOOP_FETCH_RETRY: '0' };
const git = (cwd, ...a) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd, encoding: 'utf8', env }).trim();

/** Runs a command without blocking the event loop (the server below answers it). */
async function run(cmd, args, opts) {
  try {
    const { stdout, stderr } = await execFile(cmd, args, { encoding: 'utf8', env, maxBuffer: 1 << 24, ...opts });
    return { status: 0, stdout, stderr };
  } catch (e) {
    return { status: e.code ?? 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

// /up/* answers 403 like greenwoodsoftware.com does the pool; /good/* and /bad/* serve bytes.
const GOOD = 'less 668 source\n';
const BAD = 'something else\n';
let server;
let origin;
before(async () => {
  server = createServer((req, res) => {
    const [, dir, file] = req.url.split('/');
    if (dir === 'up') {
      res.writeHead(403).end('forbidden');
    } else if (dir === 'good' || dir === 'bad') {
      res.writeHead(200).end(dir === 'good' ? GOOD.replace('668', file.match(/\d+/)?.[0] ?? '668') : BAD);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const good = (v = '668') => GOOD.replace('668', v);
const recipe = ({ version = '668', pin, mirrors = ['bad', 'good'] }) =>
  [
    'name: fx',
    'builder: host',
    `version: "${version}"`,
    'source:',
    `  url: "${origin}/up/fx-{{version}}.tar.gz"`,
    `  sha256: "${pin}"`,
    '  mirrors:',
    ...mirrors.map((m) => `    - "${origin}/${m}/fx-{{version}}.tar.gz"`),
    '',
  ].join('\n');

/** A homescoop-like repo: packages/fx at `base` on main, `head` on branch pr. */
function repo({ base, head }) {
  const dir = mkdtempSync(join(tmpdir(), 'source-mirrors-'));
  mkdirSync(join(dir, 'scripts'));
  for (const f of ['refresh-recipe-sha.mjs', 'read-recipe.mjs', 'source-tree.mjs', 'recipe-env.mjs', 'build-common.sh']) {
    copyFileSync(join(scripts, f), join(dir, 'scripts', f));
  }
  mkdirSync(join(dir, 'packages/fx'), { recursive: true });
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'packages/fx/recipe.yaml'), base);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'pr');
  writeFileSync(join(dir, 'packages/fx/recipe.yaml'), head);
  git(dir, 'commit', '-q', '--allow-empty', '-am', 'head');
  return {
    dir,
    refresh: (...extra) => run(process.execPath, [join(dir, 'scripts/refresh-recipe-sha.mjs'), 'fx', '--base', 'main', ...extra], { cwd: dir }),
    read: () => readFileSync(join(dir, 'packages/fx/recipe.yaml'), 'utf8'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('url 403 + a mirror with the pinned sha256: PASS from the mirror, nothing written', async () => {
  const text = recipe({ pin: sha(good()) });
  const f = repo({ base: text, head: text });
  try {
    const r = await f.refresh('--verify-repack', '--verify-tree');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`mirror ${origin}/bad/fx-668\\.tar\\.gz: sha256 ${sha(BAD)} does not match the pin`));
    assert.ok(r.stdout.includes(`source: fx from mirror ${origin}/good/fx-668.tar.gz (sha256 match)`), r.stdout);
    assert.match(r.stdout, /recipe-sha: PASS 1 recipe/);
    assert.equal(f.read(), text);
  } finally {
    f.cleanup();
  }
});

test('url 403 + only mirrors with the wrong sha256: FAIL, nothing written', async () => {
  const text = recipe({ pin: sha(good()), mirrors: ['bad', 'missing'] });
  const f = repo({ base: text, head: text });
  try {
    const r = await f.refresh();
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /recipe-sha: FAIL fx: .*no source\.mirrors entry matches the pin/);
    assert.equal(f.read(), text);
  } finally {
    f.cleanup();
  }
});

test('a pin refresh (a version bump) never takes a mirror: url 403 fails, even when a mirror has the bytes', async () => {
  const head = recipe({ version: '669', pin: sha(good()) });
  const f = repo({ base: recipe({ pin: sha(good()) }), head });
  try {
    const r = await f.refresh();
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stdout, /recipe-sha: FAIL fx: .*download failed for .*\/up\/fx-669\.tar\.gz .*mirrors can't stand in: the url changed against main/);
    assert.doesNotMatch(r.stdout, /source: fx from mirror/);
    assert.equal(f.read(), head);
  } finally {
    f.cleanup();
  }
});

test('a pin the branch set to a mirror\'s bytes is refused', async () => {
  for (const [label, base, head] of [
    ['new URL', recipe({ pin: sha(good()) }), recipe({ version: '669', pin: sha(good('669')) })],
    ['same URL', recipe({ pin: 'a'.repeat(64) }), recipe({ pin: sha(good()) })],
    ['empty pin', recipe({ pin: '' }), recipe({ pin: '' })],
  ]) {
    const f = repo({ base, head });
    try {
      const r = await f.refresh();
      assert.notEqual(r.status, 0, `${label}: ${r.stdout}`);
      assert.match(r.stdout, /recipe-sha: FAIL fx: .*mirrors can't stand in: .*A mirror never sets or refreshes a pin/, label);
      assert.doesNotMatch(r.stdout, /source: fx from mirror/, label);
      assert.equal(f.read(), head, label);
    } finally {
      f.cleanup();
    }
  }
});

test('a shallow checkout (ladder-pr build jobs, pool-parity) compares against the base tip', async () => {
  const text = recipe({ pin: sha(good()) });
  const f = repo({ base: text, head: text });
  const clone = mkdtempSync(join(tmpdir(), 'source-mirrors-shallow-'));
  try {
    git(clone, 'clone', '-q', '--depth=1', '--branch', 'pr', `file://${f.dir}`, 'c');
    const cwd = join(clone, 'c');
    const r = await run(process.execPath, [join(cwd, 'scripts/refresh-recipe-sha.mjs'), 'fx'], { cwd });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /base: shallow checkout, comparing against the tip of main/);
    assert.ok(r.stdout.includes(`source: fx from mirror ${origin}/good/fx-668.tar.gz (sha256 match)`), r.stdout);
  } finally {
    rmSync(clone, { recursive: true, force: true });
    f.cleanup();
  }
});

/** homescoop_fetch as a build.sh runs it, after homescoop_load_recipe. */
async function fetchInBuild(f) {
  const work = join(f.dir, 'work');
  mkdirSync(work, { recursive: true });
  const script = [
    'set -euo pipefail',
    `export HOMESCOOP_ROOT=${JSON.stringify(f.dir)} HOMESCOOP_WORK=${JSON.stringify(work)} PREFIX=${JSON.stringify(join(work, 'prefix'))}`,
    'source "$HOMESCOOP_ROOT/scripts/build-common.sh"',
    'homescoop_load_recipe fx',
    'homescoop_fetch "$SRC_URL" "$SRC_SHA" "$WORK/fx.tar.gz"',
    'cat "$WORK/fx.tar.gz"',
  ].join('\n');
  return run('bash', ['-c', script], { cwd: f.dir });
}

test('homescoop_fetch: url 403 falls back to the mirror whose bytes match the pin', async () => {
  const text = recipe({ pin: sha(good()) });
  const f = repo({ base: text, head: text });
  try {
    const r = await fetchInBuild(f);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`mirror ${origin}/bad/fx-668\\.tar\\.gz has sha256 ${sha(BAD)}, not the pin`));
    assert.ok(r.stdout.includes(`source: fx from mirror ${origin}/good/fx-668.tar.gz (sha256 match)`), r.stdout);
    assert.ok(r.stdout.endsWith(good()), r.stdout);
  } finally {
    f.cleanup();
  }
});

test('homescoop_fetch: url 403 and no mirror with the pinned bytes fails', async () => {
  const text = recipe({ pin: sha(good()), mirrors: ['bad'] });
  const f = repo({ base: text, head: text });
  try {
    const r = await fetchInBuild(f);
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /homescoop_fetch: download failed/);
    assert.doesNotMatch(r.stdout, /source: fx from mirror/);
  } finally {
    f.cleanup();
  }
});

test('mirrors, like a pinned url, are not a build input', () => {
  const src = { url: 'https://a/x.tar.gz', sha256: 'a'.repeat(64) };
  assert.equal(buildView({ name: 'fx', source: src }), buildView({ name: 'fx', source: { ...src, mirrors: ['https://b/x.tar.gz'] } }));
  assert.notEqual(
    buildView({ name: 'fx', source: { url: 'u', sha256: '' } }),
    buildView({ name: 'fx', source: { url: 'u', sha256: '', mirrors: ['m'] } })
  );
});
