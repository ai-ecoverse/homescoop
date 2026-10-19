/**
 * Where a project is, and which pnpm it pins (12.9.1-15, patches/0007 and
 * 0008), as root with the base set's /node_modules at the root, as in slicc.
 *
 * - 0008: `pnpm add` in a directory without a manifest of its own acts on
 *   that directory. 12.9.1-13 walked up to `/` (its node_modules is a
 *   project marker), scaffolded /package.json in /.tmpXXXXXX and failed with
 *   ERR_PNPM_PACKAGE_MANIFEST_IO_ERROR (os error 44), leaving the temp file.
 * - 0007: `pnpm init` pins the running pnpm, not the registry's latest.
 *   12.9.1-13 pinned latest (here 99.0.0, onFail: download), and the next
 *   `pnpm add` failed with ERR_PNPM_UNSUPPORTED_RUNTIME.
 */
import { createHash } from 'node:crypto';
import { tarball } from '../test/fixtures/registry.mjs';

const REGISTRY = 'http://registry.test/';
const tgz = tarball({ 'package.json': JSON.stringify({ name: 'tiny', version: '1.0.0', main: 'index.js' }), 'index.js': 'module.exports = 1;\n' });
const TINY = { tgz: tgz.toString('base64'), integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` };
const registry = {
  toString: () => `(req) => {
    const TINY = ${JSON.stringify(TINY)};
    const BASE = ${JSON.stringify(REGISTRY)};
    const json = (body) => ({ headers: [['content-type', 'application/json']], body: JSON.stringify(body) });
    const u = new URL(req.url);
    if (u.host !== 'registry.test') return { status: 502, body: 'unreachable' };
    if (u.pathname === '/tiny/-/tiny-1.0.0.tgz') {
      const bin = atob(TINY.tgz);
      return { headers: [['content-type', 'application/octet-stream']], body: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
    }
    if (u.pathname === '/tiny') return json({ name: 'tiny', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'tiny', version: '1.0.0', main: 'index.js', dist: { tarball: BASE + 'tiny/-/tiny-1.0.0.tgz', integrity: TINY.integrity } } } });
    // A latest pnpm newer than the build, which a WebContainer can't switch to.
    if (u.pathname === '/pnpm') return json({ name: 'pnpm', 'dist-tags': { latest: '99.0.0' }, time: { '99.0.0': '2026-01-01T00:00:00.000Z' }, versions: { '99.0.0': { name: 'pnpm', version: '99.0.0', dist: { tarball: BASE + 'pnpm/-/pnpm-99.0.0.tgz', integrity: 'sha512-AAAA' } } } });
    return { status: 404, headers: [['content-type', 'application/json']], body: '{"error":"not found"}' };
  }`,
};

export default async function (ctx) {
  const { run, write, read, assert, serve } = ctx;
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout.slice(-1500)}\n--- stderr\n${r.stderr.slice(-2500)}`;
  const rootTemps = async () => (await run(['bash', '-c', 'ls -A / | grep "^\\.tmp" || true'], { cwd: '/' })).stdout.trim();
  await serve(registry);
  await write('/node_modules/.base-set', '');
  const temps = await rootTemps();

  // 0008: a directory without a manifest is its own project.
  await run(['mkdir', '-p', '/tmp/empty'], { cwd: '/' });
  const add = await run(['pnpm', 'add', 'tiny', '--registry', REGISTRY], { cwd: '/tmp/empty' });
  assert.equal(add.status, 0, `pnpm add in a directory without package.json: ${out(add)}`);
  const manifest = JSON.parse((await read('/tmp/empty/package.json')) ?? '{}');
  assert.equal(manifest.dependencies?.tiny, '^1.0.0', '/tmp/empty/package.json has tiny');
  assert.ok(!(await read('/package.json')), 'no /package.json');
  assert.equal(await rootTemps(), temps, 'no new .tmp* file at /');

  // 0007: init pins the running pnpm, and the project works with it.
  await run(['mkdir', '-p', '/tmp/init'], { cwd: '/' });
  const init = await run(['pnpm', 'init', '--registry', REGISTRY], { cwd: '/tmp/init' });
  assert.equal(init.status, 0, `pnpm init: ${out(init)}`);
  const version = (await run(['pnpm', '--version'], { cwd: '/' })).stdout.trim();
  const pinned = JSON.parse((await read('/tmp/init/package.json')) ?? '{}');
  assert.equal(pinned.packageManager, `pnpm@${version}`, `init pins the running pnpm: ${JSON.stringify(pinned)}`);
  assert.equal(pinned.devEngines?.packageManager?.version, version, 'devEngines pins the running pnpm');
  const after = await run(['pnpm', 'add', 'tiny', '--registry', REGISTRY], { cwd: '/tmp/init' });
  assert.equal(after.status, 0, `pnpm add after pnpm init: ${out(after)}`);
  assert.doesNotMatch(after.stderr, /UNSUPPORTED_RUNTIME/, out(after));
}
