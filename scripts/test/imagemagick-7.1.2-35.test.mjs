import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const im = join(root, 'packages/imagemagick');
const heif = join(root, 'packages/imagemagick-heif');

test('upstream 7.1.2-35 absorbs homescoop#624; mogrify-format-over-existing.patch is gone', () => {
  assert.equal(existsSync(join(im, 'mogrify-format-over-existing.patch')), false);
  const patches = readdirSync(im).filter((f) => f.endsWith('.patch')).sort();
  assert.deepEqual(patches, [
    'jp2-tile-large.patch',
    'mogrify-inplace-keep-mode-owner.patch',
    'mogrify-per-file-status.patch',
    'timer-monotonic-emscripten.patch',
    'webp-check-size-before-open.patch',
    'write-temp-then-rename.patch',
  ]);
});

test('imagemagick and imagemagick-heif certs read recipe.yaml for magick -version', () => {
  for (const [dir, file] of [
    [im, 'cert/checklist.mjs'],
    [heif, 'cert/checklist.mjs'],
  ]) {
    const text = readFileSync(join(dir, file), 'utf8');
    assert.match(text, /recipe\.yaml/);
    assert.doesNotMatch(text, /7\\.1\\.2-34 /);
    const ver = /^version: "([^"]+)"$/m.exec(readFileSync(join(dir, 'recipe.yaml'), 'utf8'))[1];
    assert.equal(ver, '7.1.2-35');
  }
});

test('OpenJPEG 2.5.4 pin from #1959 stays on both ImageMagick recipes', () => {
  for (const dir of [im, heif]) {
    const recipe = readFileSync(join(dir, 'recipe.yaml'), 'utf8');
    assert.match(recipe, /@ai-ecoverse\/wasm-openjpeg@2\.5\.4-1/);
  }
});
