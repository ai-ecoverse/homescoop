// refresh-recipe-sha.mjs verifies repack recipes' source pins (#730): a repack
// never fetches its source, so a wrong sha256 must fail here and not be rewritten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** A tree with scripts/{refresh-recipe-sha,read-recipe}.mjs and one fixture recipe. */
function fixture({ pin, repack = true, allow = '', issues = {}, attested = {}, verify = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'recipe-sha-test-'));
  mkdirSync(join(dir, 'scripts'));
  for (const f of ['refresh-recipe-sha.mjs', 'read-recipe.mjs', 'gate.mjs']) copyFileSync(join(scripts, f), join(dir, 'scripts', f));
  if (allow) writeFileSync(join(dir, 'scripts/recipe-sha-allowlist.txt'), allow);
  const src = join(dir, 'src-1.0.tar.gz');
  writeFileSync(src, 'source bytes\n');
  mkdirSync(join(dir, 'packages/fx'), { recursive: true });
  const recipe = [
    'name: fx',
    'builder: host',
    'version: "1.0"',
    'source:',
    `  url: "file://${dir}/src-{{version}}.tar.gz"`,
    `  sha256: "${pin === 'right' ? sha(readFileSync(src)) : pin === 'skip' ? 'skip' : 'f'.repeat(64)}"`,
    ...(repack ? ['repack:', '  from: "1.0-1"'] : []),
    '',
  ].join('\n');
  writeFileSync(join(dir, 'packages/fx/recipe.yaml'), recipe);
  writeFileSync(join(dir, 'fixtures.json'), JSON.stringify({ issues, attested }));
  const run = () =>
    spawnSync(process.execPath, [join(dir, 'scripts/refresh-recipe-sha.mjs'), 'fx', ...(verify ? ['--verify-repack'] : [])], {
      encoding: 'utf8',
      env: { ...process.env, RECIPE_SHA_FIXTURES: join(dir, 'fixtures.json') },
    });
  const read = () => readFileSync(join(dir, 'packages/fx/recipe.yaml'), 'utf8');
  return { dir, run, read, recipe };
}

test('a repack whose pin is wrong fails, and the recipe is not rewritten', () => {
  const f = fixture({ pin: 'wrong' });
  try {
    const r = f.run();
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /recipe sha256 f{64} != downloaded .* This recipe is a repack/);
    assert.equal(f.read(), f.recipe);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('a repack whose pin is right passes', () => {
  const f = fixture({ pin: 'right' });
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /verify fx: repack of 1\.0-1/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('without --verify-repack a repack is skipped (builds download nothing)', () => {
  const f = fixture({ pin: 'wrong', verify: false });
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /skip fx: repack of 1\.0-1/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('an allowlisted mismatch passes while its issue is open and its chain unattested', () => {
  const f = fixture({ pin: 'wrong', allow: '# comment\nfx #730 known bad pin\n', issues: { 730: 'OPEN' }, attested: { fx: false } });
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /known fx: .*allowlisted \(fx #730 known bad pin\): source: f{64} != /);
    assert.equal(f.read(), f.recipe);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('a stale allowlist entry fails: pins now match, issue closed, or chain attested', () => {
  const cases = [
    [{ pin: 'right' }, /is stale: its pins now match/],
    [{ pin: 'wrong', issues: { 730: 'CLOSED' } }, /is stale: #730 is closed/],
    [{ pin: 'wrong', attested: { fx: true } }, /is stale: its repack chain is now attested/],
  ];
  for (const [opts, re] of cases) {
    const f = fixture({ allow: 'fx #730 known bad pin\n', ...opts });
    try {
      const r = f.run();
      assert.notEqual(r.status, 0, r.stdout);
      assert.match(r.stderr, re);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
});

test('a malformed allowlist line fails', () => {
  let f;
  f = fixture({ pin: 'wrong', allow: 'fx no issue\n' });
  try {
    const r = f.run();
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /want "<package> #<issue> <reason>"/);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('a non-repack with a wrong pin is still rewritten (Renovate flow); sha256 skip is left alone', () => {
  let f = fixture({ pin: 'wrong', repack: false });
  try {
    assert.equal(f.run().status, 0);
    assert.ok(f.read().includes(sha(Buffer.from('source bytes\n'))));
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
  f = fixture({ pin: 'skip' });
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(f.read(), f.recipe);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test('every allowlist entry names an issue and a reason', () => {
  const lines = readFileSync(join(scripts, 'recipe-sha-allowlist.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  for (const l of lines) assert.match(l, /^\S+\s+#\d+\s+\S/, l);
});
