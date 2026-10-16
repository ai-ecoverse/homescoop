// #642: wasi-impeccable's wasm cache key must change when a vendored
// crates/wasix-* file changes (cargo isn't invoked on a cache hit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function digest(dir, work) {
  return execFileSync('bash', ['-c', 'source "$HOMESCOOP_ROOT/scripts/build-common.sh"; homescoop_tree_digest "$1"', 'x', dir], {
    env: { ...process.env, HOMESCOOP_ROOT: ROOT, HOMESCOOP_WORK: join(work, 'work'), PREFIX: join(work, 'prefix') },
    encoding: 'utf8',
  }).trim();
}

function tree(base) {
  mkdirSync(join(base, 'wasix-ureq', 'src'), { recursive: true });
  writeFileSync(join(base, 'wasix-ureq', 'Cargo.toml'), '[package]\nname = "wasix-ureq"\n');
  writeFileSync(join(base, 'wasix-ureq', 'src', 'lib.rs'), 'pub const E: &str = "error";\n');
}

test('homescoop_tree_digest follows contents and names, not location', () => {
  const t = mkdtempSync(join(tmpdir(), 'tree-digest-'));
  try {
    const a = join(t, 'a');
    const b = join(t, 'elsewhere', 'b');
    tree(a);
    tree(b);
    const d0 = digest(a, t);
    assert.match(d0, /^[0-9a-f]{64}$/);
    assert.equal(digest(b, t), d0, 'same tree in another dir');
    writeFileSync(join(a, 'wasix-ureq', 'src', 'lib.rs'), 'pub const E: &str = "changed error";\n');
    const d1 = digest(a, t);
    assert.notEqual(d1, d0, 'edited file');
    writeFileSync(join(a, 'wasix-ureq', 'src', 'new.rs'), '');
    assert.notEqual(digest(a, t), d1, 'added file');
    assert.throws(() => digest(join(t, 'missing'), t));
  } finally {
    rmSync(t, { recursive: true, force: true });
  }
});

test('wasi-impeccable keys its cached wasm by the vendored crates', () => {
  const sh = readFileSync(join(ROOT, 'packages/wasi-impeccable/build.sh'), 'utf8');
  const key = sh.split('\n').find((l) => l.startsWith('KEY='));
  assert.ok(key, 'build.sh sets KEY');
  assert.match(key, /homescoop_tree_digest "\$SRC_DIR\/homescoop-crates"/);
  // The key is computed after the crates are vendored.
  assert.ok(sh.indexOf('homescoop_vendor_crates "$SRC_DIR"') < sh.indexOf('KEY='));
});
