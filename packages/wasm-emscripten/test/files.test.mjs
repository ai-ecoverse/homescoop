// homescoop#205: build.sh writes package.json's "files" for the next real
// build. npm matches those entries case-sensitively on Linux, so "Media"
// packed nothing of the staged media/ (it matched only on macOS, where
// 6.0.9-11 was packed). Checked against the built tarball (ladder-pr's
// .homescoop-out/package.tgz, or HOMESCOOP_TGZ): every entry of build.sh's
// list names a top-level entry of it with exactly that spelling, and every
// top-level entry is named by one, so a Linux `npm pack` of the next real
// build keeps all of it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = new URL('..', import.meta.url);
const tgz = process.env.HOMESCOOP_TGZ || fileURLToPath(new URL('../../.homescoop-out/package.tgz', here));

function buildShFiles() {
  return JSON.parse(readFileSync(new URL('package/package.json', here), 'utf8')).files;
}

/** Top-level names in the tarball's package/, and every path. */
function tarball() {
  assert.ok(existsSync(tgz), `no tarball at ${tgz}`);
  const paths = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean);
  const top = new Set(paths.map((p) => p.replace(/^package\//, '').split('/')[0]).filter(Boolean));
  return { paths, top: [...top] };
}

const matches = (entry, name) => (entry.startsWith('*.') ? name.endsWith(entry.slice(1)) : entry === name);

test('build.sh files entries name the tarball exactly (case-sensitive)', () => {
  const { top } = tarball();
  assert.ok(top.includes('emcc.py'), `${tgz} is not a wasm-emscripten tarball (no emcc.py)`);
  const missing = buildShFiles().filter((f) => !top.some((n) => matches(f, n)));
  const near = missing.map((f) => `${f} (there: ${top.filter((n) => n.toLowerCase() === f.toLowerCase()).join(', ') || 'nothing'})`);
  assert.deepEqual(near, [], `build.sh files entries that match nothing in the tarball: ${near.join('; ')}`);
});

test('every top-level entry of the tarball is in build.sh files', () => {
  const files = buildShFiles();
  const dropped = tarball().top.filter((n) => n !== 'package.json' && !files.some((f) => matches(f, n)));
  assert.deepEqual(dropped, [], `npm pack of the next build would drop: ${dropped.join(', ')}`);
});

test('media/ (the logos) is in the tarball', () => {
  const { paths } = tarball();
  for (const f of ['logo.png', 'logo.svg', 'powered_by_logo.png']) assert.ok(paths.includes(`package/media/${f}`), `no package/media/${f}`);
});
