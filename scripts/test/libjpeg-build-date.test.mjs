// #638: wasm-libjpeg-turbo's "build YYYYMMDD" stamp comes from the recipe's
// source.epoch (in UTC), not the day or time zone of the build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = join(ROOT, 'packages/libjpeg-turbo');
const sh = readFileSync(join(PKG, 'build.sh'), 'utf8');

function field(f) {
  return execFileSync('node', [join(ROOT, 'scripts/read-recipe.mjs'), 'libjpeg-turbo', '--field', f], { encoding: 'utf8' }).trim();
}

// Run build.sh's own JPEG_BUILD_DATE line (not a copy of it).
function buildDate(epoch, tz) {
  const line = sh.split('\n').find((l) => l.startsWith('JPEG_BUILD_DATE='));
  assert.ok(line, 'build.sh sets JPEG_BUILD_DATE');
  return execFileSync('bash', ['-c', `set -euo pipefail; SOURCE_DATE_EPOCH="$1"; ${line}; printf %s "$JPEG_BUILD_DATE"`, 'x', epoch], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
}

test('the build stamp is pinned to source.epoch in UTC', () => {
  const epoch = field('source.epoch');
  assert.match(epoch, /^\d+$/);
  const want = new Date(Number(epoch) * 1000).toISOString().slice(0, 10).replaceAll('-', '');
  for (const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    assert.equal(buildDate(epoch, tz), want, tz);
  }
  assert.equal(buildDate('1756257067', 'Pacific/Kiritimati'), '20250827');
  assert.throws(() => buildDate('', 'UTC'));
});

test('build.sh hands the stamp to CMake and checks libjpeg.a carries it', () => {
  assert.match(sh, /export SOURCE_DATE_EPOCH/);
  assert.match(sh, /-DBUILD="\$JPEG_BUILD_DATE"/);
  assert.match(sh, /\(build \$JPEG_BUILD_DATE\)/);
  assert.equal(field('reproducible'), 'true');
});
