import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const index = process.argv.indexOf('--tarball');
assert.ok(index >= 0 && process.argv[index + 1], 'usage: build-stamp.mjs --tarball <package.tgz>');
const tarball = resolve(process.argv[index + 1]);
const epoch = execFileSync(process.execPath, [resolve(root, 'scripts/read-recipe.mjs'), 'libjpeg-turbo', '--field', 'source.epoch'], { encoding: 'utf8' }).trim();
assert.match(epoch, /^\d+$/);
const expected = new Date(Number(epoch) * 1000).toISOString().slice(0, 10).replaceAll('-', '');
for (const lib of ['libjpeg.a', 'libturbojpeg.a']) {
  const path = `lib/${lib}`;
  const archive = execFileSync('tar', ['-xOf', tarball, `package/${path}`], { maxBuffer: 32 * 1024 * 1024 });
  const stamps = [...archive.toString('latin1').matchAll(/\(build (\d{8})\)/g)].map((m) => m[1]);
  assert.ok(stamps.length > 0, `${path}: embedded build stamp exists`);
  assert.deepEqual([...new Set(stamps)], [expected], `${path}: build stamp must match source.epoch ${epoch} (UTC)`);
}
console.log(`libjpeg-build-stamp: PASS both archives carry build ${expected} from source.epoch ${epoch}`);
