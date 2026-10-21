/**
 * A failed update leaves the old package whole (12.9.1-20, patches/0011,
 * homescoop#1384), as bob under users enforce. big@1.0.0 is installed, a
 * read-only directory holding a file is put inside it (an entry pnpm can't
 * unlink), and the project is updated to big@2.0.0. Upstream's
 * remove-then-rename (0010 kept it on slicc-kernel < 1.134.3) deleted the old
 * tree file by file, failed on that entry and left node_modules/big gutted.
 * 0011 renames the old tree aside on every kernel, so whichever way the
 * update ends, node_modules/big is a complete 1.0.0 or a complete 2.0.0
 * (40 or 50 files in lib/, the matching package.json), never a partial
 * tree; and after `chmod -R u+w` a second update completes 2.0.0.
 */
import { createHash } from 'node:crypto';
import { tarball } from '../test/fixtures/registry.mjs';

const REGISTRY = 'http://registry.test/';
const PKGS = {};
const add = (name, version, n) => {
  const files = { 'package.json': JSON.stringify({ name, version, main: 'lib/f000.js' }) };
  for (let i = 0; i < n; i++) files[`lib/f${String(i).padStart(3, '0')}.js`] = `module.exports = ${JSON.stringify(`${name}@${version} ${i}`)};\n${'// pad\n'.repeat(40)}`;
  const tgz = tarball(files);
  PKGS[name] ??= {};
  PKGS[name][version] = { tgz: tgz.toString('base64'), integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` };
};
add('big', '1.0.0', 40);
add('big', '2.0.0', 50);

const registry = {
  toString: () => `(req) => {
    const PKGS = ${JSON.stringify(PKGS)};
    const BASE = ${JSON.stringify(REGISTRY)};
    const u = new URL(req.url);
    if (u.host !== 'registry.test') return { status: 502, body: 'unreachable' };
    const path = decodeURIComponent(u.pathname.slice(1));
    const file = /^([^/]+)\\/-\\/[^/]+-(\\d+\\.\\d+\\.\\d+)\\.tgz$/.exec(path);
    if (file && PKGS[file[1]]?.[file[2]]) {
      const bin = atob(PKGS[file[1]][file[2]].tgz);
      return { headers: [['content-type', 'application/octet-stream']], body: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
    }
    const pkg = PKGS[path];
    if (!pkg) return { status: 404, headers: [['content-type', 'application/json']], body: '{"error":"not found"}' };
    const versions = {};
    for (const [v, p] of Object.entries(pkg)) versions[v] = { name: path, version: v, main: 'lib/f000.js', dist: { tarball: BASE + path + '/-/' + path + '-' + v + '.tgz', integrity: p.integrity } };
    const latest = Object.keys(pkg).sort().pop();
    return { headers: [['content-type', 'application/json']], body: JSON.stringify({ name: path, 'dist-tags': { latest }, versions }) };
  }`,
};

export default async function (ctx) {
  const { run, write, assert, addUser, serve } = ctx;
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout.slice(-2000)}\n--- stderr\n${r.stderr.slice(-2000)}`;
  await serve(registry);
  await addUser({ name: 'bob' });
  const app = '/home/bob/swap';
  const manifest = (v) => JSON.stringify({ name: 'swap', version: '1.0.0', private: true, dependencies: { big: v } });
  await write(`${app}/package.json`, manifest('1.0.0'));
  await run(['chown', '-R', 'bob', app], { cwd: '/' });
  const sh = (s) => run(['bash', '-c', s], { cwd: app, user: 'bob' });
  const state = async () => {
    const r = await sh('shopt -s nullglob; d=node_modules/big; f=("$d"/lib/*); v=; [ -f $d/package.json ] && { read -r v < $d/package.json; v=${v#*version?:?}; v=${v%%[!0-9.]*}; }; echo "${#f[@]} ${v:-nopj}"');
    return r.stdout.trim();
  };
  let r = await sh(`pnpm install --registry ${REGISTRY}`);
  assert.equal(r.status, 0, `install big@1.0.0: ${out(r)}`);
  assert.equal(await state(), '40 1.0.0', 'big@1.0.0 is installed');
  r = await sh('mkdir node_modules/big/lockd && echo x > node_modules/big/lockd/x && chmod 500 node_modules/big/lockd');
  assert.equal(r.status, 0, out(r));
  await write(`${app}/package.json`, manifest('2.0.0'));
  await run(['chown', 'bob', `${app}/package.json`], { cwd: '/' });
  r = await sh(`pnpm install --registry ${REGISTRY}`);
  const after = await state();
  console.log(`swap-edges: update over an unremovable entry: rc ${r.status}, node_modules/big is "${after}"`);
  assert.ok(after === '40 1.0.0' || after === '50 2.0.0', `#1384 node_modules/big is a complete 1.0.0 or 2.0.0 after the update (rc ${r.status}), not "${after}": ${out(r)}`);
  if (after === '40 1.0.0') {
    const x = await sh('cat node_modules/big/lockd/x');
    assert.equal(x.stdout, 'x\n', '#1384 the old tree is the old tree, read-only entry included');
  }
  r = await sh(`chmod -R u+w . && pnpm install --registry ${REGISTRY} && ls -A node_modules`);
  assert.equal(r.status, 0, `the update after chmod -R u+w: ${out(r)}`);
  assert.equal(await state(), '50 2.0.0', 'big@2.0.0 is installed after the retry');
  console.log(`swap-edges: node_modules after the retry: ${r.stdout.trim().split('\n').join(' ')}`);
}
