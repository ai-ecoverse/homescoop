#!/usr/bin/env node
// py-matplotlib cert (host ci command, homescoop#211 A5): every .py under
// matplotlib/, mpl_toolkits/ and pylab.py in a package tarball is the pinned
// PyPI sdist's file (under lib/), byte for byte. Files the build adds are listed.
//   node packages/py-matplotlib3.15/test/py-vs-sdist.mjs --tarball <package.tgz>
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
const recipe = JSON.parse(execFileSync(process.execPath, [join(root, 'scripts/read-recipe.mjs'), 'py-matplotlib3.15', '--json'], { encoding: 'utf8' }));
const version = recipe.version;
const url = recipe.source.url.replaceAll('{{version}}', version);
const sha = recipe.source.sha256;
// The build adds these (meson install of the sdist's top-level files).
const ADDED = new Set(process.env.MPL_ADDED ? process.env.MPL_ADDED.split(',') : ['matplotlib/_version.py']);
const PATCHED = new Set();
// In the sdist but not in lib/matplotlib/tests/meson.build's install list, so
// matplotlib's own meson install (and PyPI's wheels) leave them out.
const NOT_INSTALLED = new Set(['matplotlib/tests/test__style_helpers.py', 'matplotlib/tests/test_inset.py', 'matplotlib/tests/test_typing.py']);

const work = mkdtempSync(join(tmpdir(), 'py-matplotlib-sdist-'));
try {
  const sdist = join(work, 'sdist.tar.gz');
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', sdist, url]);
  const got = createHash('sha256').update(readFileSync(sdist)).digest('hex');
  assert.equal(got, sha, `${url}: sha256 ${got}, recipe pins ${sha}`);
  execFileSync('tar', ['xzf', sdist, '-C', work]);
  const src = join(work, `matplotlib-${version}`, 'lib');
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
    for (const top of ['matplotlib', 'mpl_toolkits']) walk(join(dir, top));
    if (existsSync(join(dir, 'pylab.py'))) out.push('pylab.py');
    return new Set(out);
  };
  const shipped = pys(site);
  const upstream = pys(src);
  const patched = src;
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
  const missing = [...upstream].filter((f) => !shipped.has(f) && !NOT_INSTALLED.has(f));
  for (const f of NOT_INSTALLED) assert.ok(upstream.has(f) && !shipped.has(f), `${f}: NOT_INSTALLED is stale`);
  for (const f of ADDED) assert.ok(shipped.has(f), `${f} isn't shipped`);
  assert.deepEqual(differs, [], differs.join('\n'));
  assert.deepEqual(missing, [], `sdist .py files not shipped:\n${missing.join('\n')}`);
  console.log(`PASS test/py-vs-sdist.mjs: ${shipped.size} matplotlib/mpl_toolkits/pylab .py files; ${shipped.size - ADDED.size} equal matplotlib-${version}.tar.gz's lib/ (sha256 ${sha.slice(0, 12)}…), ${ADDED.size} added by the build (${[...ADDED].join(', ')}); ${NOT_INSTALLED.size} sdist test files matplotlib's meson.build doesn't install`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
