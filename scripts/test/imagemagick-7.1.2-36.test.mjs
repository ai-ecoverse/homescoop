import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const im = join(root, 'packages/imagemagick');
const heif = join(root, 'packages/imagemagick-heif');
const relink = join(root, 'packages/imagemagick-relink');
const read = (...p) => readFileSync(join(...p), 'utf8');
const added = (patch) => patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');

test('7.1.2-36 carries read-own-errors.patch and path-policy-keep-errno.patch; mogrify-format-over-existing.patch stays gone', () => {
  assert.equal(existsSync(join(im, 'mogrify-format-over-existing.patch')), false);
  const patches = readdirSync(im).filter((f) => f.endsWith('.patch')).sort();
  assert.deepEqual(patches, [
    'jp2-tile-large.patch',
    'mogrify-inplace-keep-mode-owner.patch',
    'mogrify-per-file-status.patch',
    'path-policy-keep-errno.patch',
    'read-own-errors.patch',
    'timer-monotonic-emscripten.patch',
    'webp-check-size-before-open.patch',
    'write-temp-then-rename.patch',
  ]);
});

test('read-own-errors.patch reads through ReadOneImage with its own exception once an error is pending (homescoop#2218)', () => {
  const p = read(im, 'read-own-errors.patch');
  assert.match(p, /^--- a\/MagickCore\/constitute\.c$/m);
  assert.match(p, /^-static Image \*ReadImageInternal\(const ImageInfo \*image_info,$/m);
  assert.match(p, /^\+static Image \*ReadOneImage\(const ImageInfo \*image_info,$/m);
  assert.match(p, /^\+  if \(exception->severity < ErrorException\)\n\+    return\(ReadOneImage\(image_info,postprocess,exception\)\);$/m);
  assert.match(p, /^\+  read_exception=AcquireExceptionInfo\(\);\n\+  image=ReadOneImage\(image_info,postprocess,read_exception\);\n\+  InheritException\(exception,read_exception\);$/m);
  assert.doesNotMatch(added(p), /\/\*|\/\//);
});

test('path-policy-keep-errno.patch restores errno around the realpath calls (homescoop#2217)', () => {
  const p = read(im, 'path-policy-keep-errno.patch');
  assert.match(p, /^--- a\/MagickCore\/policy\.c$/m);
  assert.match(p, /^\+      saved_errno=errno;\n {7}paths_provisioned=MagickTrue;$/m);
  assert.match(p, /^ {7}canonical_path=realpath_utf8\(pattern\);\n\+      errno=saved_errno;$/m);
  assert.doesNotMatch(added(p), /\/\*|\/\//);
});

test('write-temp-then-rename.patch keeps or drops the temporary file on the write\'s own errors (homescoop#2219)', () => {
  const p = read(im, 'write-temp-then-rename.patch');
  assert.match(p, /^\+  ExceptionInfo\n\+    \*write_exception;\n\+\n\+  ExceptionType\n\+    write_severity;$/m);
  assert.match(p, /^\+  write_exception=exception;\n\+  if \(\(\*atomic_tmp != '\\0'\) && \(exception->severity >= ErrorException\)\)\n\+    write_exception=AcquireExceptionInfo\(\);$/m);
  assert.match(p, /^-    status&=\(MagickStatusType\) WriteImage\(write_info,p,exception\);\n\+    status&=\(MagickStatusType\) WriteImage\(write_info,p,write_exception\);$/m);
  assert.match(p, /^ {3}write_info=DestroyImageInfo\(write_info\);\n\+  write_severity=write_exception->severity;\n\+  if \(write_exception != exception\)\n\+ {4}\{\n\+ {6}InheritException\(exception,write_exception\);\n\+ {6}write_exception=DestroyExceptionInfo\(write_exception\);\n\+ {4}\}$/m);
  assert.match(p, /^\+      if \(\(status != 0\) && \(write_severity < ErrorException\)\)$/m);
  assert.doesNotMatch(p, /exception->severity < ErrorException/);
  assert.doesNotMatch(added(p).split('\n').filter((l) => /write_(exception|severity)/.test(l)).join('\n'), /\/\*|\/\//);
});

test('both policies have a named entry for -list policy (homescoop#2217)', () => {
  assert.match(read(im, 'policy-tab.xml'), /<policy domain="coder" name="mpc" rights="none" pattern="\{MPC,CACHE\}"\/>/);
  assert.doesNotMatch(read(im, 'policy-tab.xml'), /<policy (?![^>]*name=)[^>]*\/>/);
  for (const dir of [im, heif]) {
    const sh = read(dir, 'build.sh');
    assert.ok(sh.includes(`perl -i -pe 's{<policy domain="Undefined" rights="none"/>}{<policy domain="Undefined" name="open" rights="none"/>}' "$CFG_OPEN/policy.xml"`), `${dir}/build.sh names the open entry`);
    assert.ok(sh.includes(`if ! grep -q '<policy domain="Undefined" name="open" rights="none"/>' "$CFG_OPEN/policy.xml"; then`), `${dir}/build.sh fails without it`);
  }
});

test('read-errors.mjs and multi-input-write.mjs run for both runtime packages', () => {
  for (const spec of ['read-errors.mjs', 'multi-input-write.mjs']) {
    assert.ok(existsSync(join(im, 'cert', spec)));
    assert.equal(read(heif, 'cert', spec), `export { default } from '../../imagemagick/cert/${spec}';\n`);
  }
});

test('imagemagick and imagemagick-heif certs read recipe.yaml for magick -version; all three recipes are 7.1.2-36', () => {
  for (const dir of [im, heif]) {
    const text = read(dir, 'cert/checklist.mjs');
    assert.match(text, /recipe\.yaml/);
    assert.doesNotMatch(text, /7\\.1\\.2-3[45] /);
  }
  for (const dir of [im, heif, relink]) {
    const ver = /^version: "([^"]+)"$/m.exec(read(dir, 'recipe.yaml'))[1];
    assert.equal(ver, '7.1.2-36');
    assert.equal(JSON.parse(read(dir, 'package/package.json')).version, '7.1.2-36-2');
  }
});

test('OpenJPEG 2.5.4 pin from #1959 stays on both ImageMagick recipes', () => {
  for (const dir of [im, heif]) {
    assert.match(read(dir, 'recipe.yaml'), /@ai-ecoverse\/wasm-openjpeg@2\.5\.4-1/);
  }
});
