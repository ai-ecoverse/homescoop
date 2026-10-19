/**
 * A large package installs and updates (12.9.1-13). 12.9.1-11/-12 staged every
 * imported package and renamed the directory into place; on slicc-kernel
 * <= 1.124.x with a browser that can't move OPFS directories that rename
 * copies the tree, and for a package the size of openai it timed out
 * ("failed to rename staging directory … Operation timed out (os error 73)")
 * in 41 of 160 agent installs (homescoop#1127's loop). bob installs
 * huge@1.0.0 (1200 files) from scratch, then updates it to huge@2.0.0.
 */
import { createHash } from 'node:crypto';
import { tarball } from '../test/fixtures/registry.mjs';

const REGISTRY = 'http://registry.test/';
const N = 1200;
const PKGS = {};
for (const version of ['1.0.0', '2.0.0']) {
  const files = { 'package.json': JSON.stringify({ name: 'huge', version, main: 'lib/d00/f0000.js' }) };
  for (let i = 0; i < N; i++) files[`lib/d${String(i % 40).padStart(2, '0')}/f${String(i).padStart(4, '0')}.js`] = `module.exports = ${JSON.stringify(`${version} ${i}`)};\n`;
  const tgz = tarball(files);
  PKGS[version] = { tgz: tgz.toString('base64'), integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` };
}
const registry = {
  toString: () => `(req) => {
    const PKGS = ${JSON.stringify(PKGS)};
    const BASE = ${JSON.stringify(REGISTRY)};
    const u = new URL(req.url);
    if (u.host !== 'registry.test') return { status: 502, body: 'unreachable' };
    const file = /^\\/huge\\/-\\/huge-(\\d+\\.\\d+\\.\\d+)\\.tgz$/.exec(u.pathname);
    if (file && PKGS[file[1]]) {
      const bin = atob(PKGS[file[1]].tgz);
      return { headers: [['content-type', 'application/octet-stream']], body: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
    }
    if (u.pathname !== '/huge') return { status: 404, headers: [['content-type', 'application/json']], body: '{"error":"not found"}' };
    const versions = {};
    for (const [v, p] of Object.entries(PKGS)) versions[v] = { name: 'huge', version: v, main: 'lib/d00/f0000.js', dist: { tarball: BASE + 'huge/-/huge-' + v + '.tgz', integrity: p.integrity } };
    return { headers: [['content-type', 'application/json']], body: JSON.stringify({ name: 'huge', 'dist-tags': { latest: '2.0.0' }, versions }) };
  }`,
};

export default async function (ctx) {
  const { run, write, read, assert, addUser, serve } = ctx;
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout.slice(-1500)}\n--- stderr\n${r.stderr.slice(-2500)}`;
  await serve(registry);
  await addUser({ name: 'bob' });
  const app = '/home/bob/huge';
  for (const [version, step] of [['1.0.0', 'install'], ['2.0.0', 'update']]) {
    await write(`${app}/package.json`, JSON.stringify({ name: 'h', version: '1.0.0', private: true, dependencies: { huge: version } }));
    await run(['chown', '-R', 'bob', app], { cwd: '/' });
    const t0 = Date.now();
    const r = await run(['pnpm', 'install', '--registry', REGISTRY], { cwd: app, user: 'bob' });
    assert.equal(r.status, 0, `${step} huge@${version} (${N} files): ${out(r)}`);
    assert.doesNotMatch(r.stderr, /os error 73|staging directory/, `${step}: ${out(r)}`);
    const pj = JSON.parse((await read(`${app}/node_modules/huge/package.json`)) ?? '{}');
    assert.equal(pj.version, version, `${step}: node_modules/huge is ${version}`);
    const last = await read(`${app}/node_modules/huge/lib/d39/f${String(N - 1).padStart(4, '0')}.js`);
    assert.equal(last, `module.exports = ${JSON.stringify(`${version} ${N - 1}`)};\n`, `${step}: the last file is ${version}'s`);
    console.log(`large-package: ${step} huge@${version} (${N} files) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
}
