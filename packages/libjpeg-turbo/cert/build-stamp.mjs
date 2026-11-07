import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pkg = join(root, 'packages/libjpeg-turbo');
const index = process.argv.indexOf('--tarball');
assert.ok(index >= 0 && process.argv[index + 1], 'usage: build-stamp.mjs --tarball <package.tgz>');
const tarball = resolve(process.argv[index + 1]);

const field = (f) =>
  execFileSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), 'libjpeg-turbo', '--field', f], {
    encoding: 'utf8',
  }).trim();
const version = field('version');
const sha = field('source.sha256');
const url = field('source.url').replaceAll('{{version}}', version);
assert.match(sha, /^[0-9a-f]{64}$/);

const cache = join(tmpdir(), `homescoop-libjpeg-turbo-src-${sha.slice(0, 12)}`);
const srcTar = join(cache, `libjpeg-turbo-${version}.tar.gz`);
if (!existsSync(srcTar) || createHash('sha256').update(readFileSync(srcTar)).digest('hex') !== sha) {
  mkdirSync(cache, { recursive: true });
  const part = `${srcTar}.part`;
  execFileSync('curl', ['-fsSL', '--retry', '5', '--retry-all-errors', '-o', part, url]);
  const got = createHash('sha256').update(readFileSync(part)).digest('hex');
  assert.equal(got, sha, `${url}: sha256 ${got}, recipe pins ${sha}`);
  writeFileSync(srcTar, readFileSync(part));
}

const epoch = execFileSync(process.execPath, [join(pkg, 'tarball-epoch.mjs'), srcTar], { encoding: 'utf8' }).trim();
assert.match(epoch, /^\d+$/);
const expected = new Date(Number(epoch) * 1000).toISOString().slice(0, 10).replaceAll('-', '');
for (const lib of ['libjpeg.a', 'libturbojpeg.a']) {
  const path = `lib/${lib}`;
  const archive = execFileSync('tar', ['-xOf', tarball, `package/${path}`], { maxBuffer: 32 * 1024 * 1024 });
  const stamps = [...archive.toString('latin1').matchAll(/\(build (\d{8})\)/g)].map((m) => m[1]);
  assert.ok(stamps.length > 0, `${path}: embedded build stamp exists`);
  assert.deepEqual(
    [...new Set(stamps)],
    [expected],
    `${path}: build stamp must match source tarball newest mtime ${epoch} (UTC ${expected})`,
  );
}
console.log(`libjpeg-build-stamp: PASS both archives carry build ${expected} from source tarball epoch ${epoch}`);
