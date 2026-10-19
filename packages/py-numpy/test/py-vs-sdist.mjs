#!/usr/bin/env node
// py-numpy cert (host ci command, homescoop#211, #730): every numpy/**/*.py
// in a package tarball is the pinned PyPI sdist's file, byte for byte, except
// the one numpy-wasm-linalg-errors.patch changes, which must equal the sdist's file
// with that patch applied. Files the build adds or drops are listed by name.
//   node packages/py-numpy/test/py-vs-sdist.mjs --tarball <package.tgz>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const tgz = arg('--tarball');
if (!tgz) {
  console.error('usage: py-vs-sdist.mjs --tarball <package.tgz>');
  process.exit(2);
}
const recipe = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), 'py-numpy', '--json'], { encoding: 'utf8' }));
const version = recipe.version;
const url = recipe.source.url.replaceAll('{{version}}', version);
const sha = recipe.source.sha256;
// The build adds these (meson install of the sdist's top-level files).
const ADDED = new Set((process.env.PY_ADDED ?? 'numpy/__config__.py,numpy/version.py').split(',').filter(Boolean));
const PATCHED = new Set(['numpy/linalg/_linalg.py']);
// Build-time scripts the sdist carries and numpy's meson install doesn't ship.
const BUILD_ONLY = ['numpy/_build_utils/', 'numpy/_core/code_generators/', 'numpy/_core/src/', 'numpy/linalg/lapack_lite/'];

const work = mkdtempSync(join(tmpdir(), 'py-numpy-sdist-'));
try {
  const sdist = join(work, 'sdist.tar.gz');
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', sdist, url]);
  const got = createHash('sha256').update(readFileSync(sdist)).digest('hex');
  assert.equal(got, sha, `${url}: sha256 ${got}, recipe pins ${sha}`);
  execFileSync('tar', ['xzf', sdist, '-C', work]);
  const src = join(work, `numpy-${version}`);
  const pkg = join(work, 'pkg');
  execFileSync('mkdir', ['-p', pkg]);
  execFileSync('tar', ['xzf', tgz, '-C', pkg]);
  const libdir = join(pkg, 'package/lib');
  const site = join(libdir, readdirSync(libdir).find((d) => /^python3\.\d+$/.test(d)), 'site-packages');
  const pys = (dir) => {
    const out = [];
    const walk = (d) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (e === '__pycache__') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (e.endsWith('.py')) out.push(relative(dir, p));
      }
    };
    walk(join(dir, 'numpy'));
    return new Set(out);
  };
  const shipped = pys(site);
  const upstream = pys(src);
  // The patched files: apply the patch to a copy of the sdist and compare.
  const patched = join(work, 'patched');
  execFileSync('cp', ['-R', src, patched]);
  execFileSync('patch', ['-d', patched, '-p1', '-s', '-i', join(root, 'packages/py-numpy/numpy-wasm-linalg-errors.patch')]);
  const differs = [];
  for (const f of shipped) {
    if (ADDED.has(f)) continue;
    if (!upstream.has(f)) {
      differs.push(`${f}: not in the sdist`);
      continue;
    }
    const want = readFileSync(join(PATCHED.has(f) ? patched : src, f));
    if (!want.equals(readFileSync(join(site, f)))) differs.push(`${f}: differs from the ${PATCHED.has(f) ? 'patched ' : ''}sdist file`);
  }
  const missing = [...upstream].filter((f) => !shipped.has(f) && !BUILD_ONLY.some((p) => f.startsWith(p)));
  for (const f of ADDED) assert.ok(shipped.has(f), `${f} isn't shipped`);
  assert.deepEqual(differs, [], differs.join('\n'));
  assert.deepEqual(missing, [], `sdist .py files not shipped:\n${missing.join('\n')}`);
  console.log(`PASS test/py-vs-sdist.mjs: ${shipped.size} numpy .py files; ${shipped.size - ADDED.size - PATCHED.size} equal numpy-${version}.tar.gz (sha256 ${sha.slice(0, 12)}…), ${PATCHED.size} equal it with numpy-wasm-linalg-errors.patch applied, ${ADDED.size} added by the build (${[...ADDED].join(', ')}); build-only sdist scripts (${BUILD_ONLY.join(' ')}) aren't installed`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
