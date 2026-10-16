// homescoop#205: build.sh writes package.json's "files" for the next real
// build. npm matches those entries case-sensitively on Linux, so "Media"
// packs nothing of the staged media/ (it matched only on macOS, where
// 6.0.9-11 was packed). Runs on the built package/ (ladder-pr unpacks the
// tarball over packages/wasm-emscripten/package): every entry of build.sh's
// list names something there with exactly that spelling, and every
// top-level entry of the tarball is named by one, so a Linux `npm pack` of
// the next real build keeps all of it.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const here = new URL('..', import.meta.url);
const pkgDir = new URL('package/', here);

/** The `files: [...]` array of the package.json build.sh writes. */
function buildShFiles() {
  const sh = readFileSync(new URL('build.sh', here), 'utf8');
  const m = /^\s*files: \[\n([\s\S]*?)^\s*\],$/m.exec(sh);
  assert.ok(m, 'build.sh has no files: [...] in its package.json');
  const body = m[1].replace(/\/\/.*$/gm, '');
  return new Function(`return [${body}]`)();
}

const matches = (entry, name) => (entry.startsWith('*.') ? name.endsWith(entry.slice(1)) && !name.includes('/') : entry === name);

test('build.sh files entries name the staged tree exactly (case-sensitive)', () => {
  assert.ok(existsSync(new URL('emcc.py', pkgDir)), 'packages/wasm-emscripten/package is not the built package (no emcc.py)');
  const files = buildShFiles();
  const top = readdirSync(pkgDir);
  const missing = files.filter((f) => !top.some((n) => matches(f, n)));
  const near = missing.map((f) => `${f} (there: ${top.filter((n) => n.toLowerCase() === f.toLowerCase()).join(', ') || 'nothing'})`);
  assert.deepEqual(near, [], `build.sh files entries that match nothing in package/: ${near.join('; ')}`);
});

test('every top-level entry of the tarball is in build.sh files', () => {
  const files = buildShFiles();
  const top = readdirSync(pkgDir).filter((n) => n !== 'package.json' && n !== 'node_modules');
  const dropped = top.filter((n) => !files.some((f) => matches(f, n)));
  assert.deepEqual(dropped, [], `npm pack of the next build would drop: ${dropped.join(', ')}`);
});

test('media/ (the logos) is in the tarball', () => {
  const media = readdirSync(new URL('media/', pkgDir)).sort();
  assert.ok(media.includes('logo.png') && media.includes('logo.svg'), `media/: ${media.join(', ')}`);
});
