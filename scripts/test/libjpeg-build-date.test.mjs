import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PKG = join(ROOT, 'packages/libjpeg-turbo');
const sh = readFileSync(join(PKG, 'build.sh'), 'utf8');
const recipe = readFileSync(join(PKG, 'recipe.yaml'), 'utf8');
const cert = readFileSync(join(PKG, 'cert/build-stamp.mjs'), 'utf8');
const epochJs = join(PKG, 'tarball-epoch.mjs');

function field(f) {
  return execFileSync('node', [join(ROOT, 'scripts/read-recipe.mjs'), 'libjpeg-turbo', '--field', f], { encoding: 'utf8' }).trim();
}

function buildDate(epoch, tz) {
  const line = sh.split('\n').find((l) => l.startsWith('JPEG_BUILD_DATE='));
  assert.ok(line, 'build.sh sets JPEG_BUILD_DATE');
  return execFileSync('bash', ['-c', `set -euo pipefail; SOURCE_DATE_EPOCH="$1"; ${line}; printf %s "$JPEG_BUILD_DATE"`, 'x', epoch], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
}

function ustarFile(name, body, mtime) {
  const buf = Buffer.alloc(512);
  Buffer.from(name).copy(buf, 0);
  buf.write('0000644\0', 100, 8, 'utf8');
  buf.write('0000000\0', 108, 8, 'utf8');
  buf.write('0000000\0', 116, 8, 'utf8');
  const size = Buffer.byteLength(body);
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'utf8');
  buf.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 12, 'utf8');
  buf[156] = 0x30;
  buf.write('ustar\0', 257, 6, 'utf8');
  buf.write('00', 263, 2, 'utf8');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : buf[i];
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
  const pad = (512 - (size % 512)) % 512;
  return Buffer.concat([buf, Buffer.from(body), Buffer.alloc(pad)]);
}

test('the recipe does not pin source.epoch', () => {
  assert.doesNotMatch(recipe, /^\s*epoch:/m);
  assert.equal(field('source.epoch'), '');
});

test('the build stamp is the tarball newest mtime in UTC', () => {
  for (const tz of ['UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    assert.equal(buildDate('1793032299', tz), '20261026', tz);
  }
  assert.equal(buildDate('1756257067', 'Pacific/Kiritimati'), '20250827');
  assert.throws(() => buildDate('', 'UTC'));
});

test('tarball-epoch.mjs returns the newest regular-file mtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'homescoop-libjpeg-epoch-'));
  const older = ustarFile('old.txt', 'a\n', 1000);
  const newer = ustarFile('new.txt', 'b\n', 1793032299);
  const tar = Buffer.concat([older, newer, Buffer.alloc(1024)]);
  const path = join(dir, 'sample.tar.gz');
  writeFileSync(path, gzipSync(tar));
  const got = execFileSync(process.execPath, [epochJs, path], { encoding: 'utf8' }).trim();
  assert.equal(got, '1793032299');
});

test('build.sh derives SOURCE_DATE_EPOCH from the fetched tarball after the sha256 check', () => {
  const fetchAt = sh.indexOf('homescoop_fetch');
  const epochAt = sh.indexOf('tarball-epoch.mjs');
  assert.ok(fetchAt >= 0, 'build.sh calls homescoop_fetch');
  assert.ok(epochAt > fetchAt, 'tarball-epoch runs after homescoop_fetch');
  assert.match(sh, /export SOURCE_DATE_EPOCH/);
  assert.match(sh, /-DBUILD="\$JPEG_BUILD_DATE"/);
  assert.match(sh, /\(build \$JPEG_BUILD_DATE\)/);
  assert.doesNotMatch(sh, /source\.epoch/);
  assert.equal(field('reproducible'), 'true');
});

test('the cert compares stamps to the source tarball newest mtime, not a recipe epoch', () => {
  assert.match(cert, /tarball-epoch\.mjs/);
  assert.doesNotMatch(cert, /source\.epoch/);
  assert.match(cert, /source\.sha256/);
});

test('NEGATIVE: published 3.2.0-2 fails the 3.2.1 source-tarball stamp', () => {
  const version = field('version');
  const sha = field('source.sha256');
  const url = field('source.url').replaceAll('{{version}}', version);
  assert.equal(version, '3.2.1');
  assert.equal(sha, 'c27ad72a68da151177929aa969ae773a2da5ac2af9ce946079314fdac8cece7f');
  const cache = join(tmpdir(), `homescoop-libjpeg-turbo-src-${sha.slice(0, 12)}`);
  const srcTar = join(cache, `libjpeg-turbo-${version}.tar.gz`);
  if (!existsSync(srcTar) || createHash('sha256').update(readFileSync(srcTar)).digest('hex') !== sha) {
    mkdirSync(cache, { recursive: true });
    const part = `${srcTar}.part`;
    execFileSync('curl', ['-fsSL', '--retry', '5', '--retry-all-errors', '-o', part, url]);
    const got = createHash('sha256').update(readFileSync(part)).digest('hex');
    assert.equal(got, sha);
    writeFileSync(srcTar, readFileSync(part));
  }
  const epoch = execFileSync(process.execPath, [epochJs, srcTar], { encoding: 'utf8' }).trim();
  assert.equal(epoch, '1793032299');
  const expected = new Date(Number(epoch) * 1000).toISOString().slice(0, 10).replaceAll('-', '');
  assert.equal(expected, '20261026');
  const published = '20260630';
  assert.notEqual(published, expected, '3.2.0-2 embeds build 20260630; 3.2.1 source expects 20261026');
});
