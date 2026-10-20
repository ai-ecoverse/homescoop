/**
 * Where a project that pins pnpm (packageManager: pnpm@12.9.1) gets pnpm's
 * own package from, with only a private registry reachable (homescoop#1256;
 * upstream pnpm's behaviour, documented in the README's "A private
 * registry"). pnpm resolves its own pin from the registry the user's
 * trusted settings name (~/.npmrc, `pnpm config set`, pnpm_config_registry),
 * not from sources a repository controls (the project's .npmrc) or from
 * --registry, so a project can't choose where pnpm itself comes from
 * (pnpm-config's build_package_manager_bootstrap).
 * - --registry, a project .npmrc and npm_config_registry alone: the pin
 *   isn't resolved (ERR_PNPM_BAD_CONFIG_DEP, registry.npmjs.org unreachable).
 * - ~/.npmrc, `pnpm config set registry` and pnpm_config_registry: rc 0, and
 *   the lockfile records packageManagerDependencies pnpm 12.9.1.
 */
import { createHash } from 'node:crypto';
import { tarball } from '../test/fixtures/registry.mjs';

const REGISTRY = 'http://registry.test/';
const tgz = tarball({ 'package.json': JSON.stringify({ name: 'tiny', version: '1.0.0', main: 'index.js' }), 'index.js': 'module.exports = 1;\n' });
const TINY = { tgz: tgz.toString('base64'), integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` };
// pnpm's own packument: the running version (a pinned project resolves it as
// a config dependency, from the default registry) and a newer latest.
const PNPM = {};
for (const v of ['12.9.1', '99.0.0']) {
  const t = tarball({ 'package.json': JSON.stringify({ name: 'pnpm', version: v, bin: { pnpm: 'bin/pnpm.cjs' } }), 'bin/pnpm.cjs': '' });
  PNPM[v] = { tgz: t.toString('base64'), integrity: `sha512-${createHash('sha512').update(t).digest('base64')}` };
}
const registry = {
  toString: () => `(req) => {
    const TINY = ${JSON.stringify(TINY)};
    const PNPM = ${JSON.stringify(PNPM)};
    const BASE = ${JSON.stringify(REGISTRY)};
    const json = (body) => ({ headers: [['content-type', 'application/json']], body: JSON.stringify(body) });
    const u = new URL(req.url);
    const bytes = (b64) => ({ headers: [['content-type', 'application/octet-stream']], body: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) });
    if (u.host === 'registry.test') {
      const m = /^\\/pnpm\\/-\\/pnpm-(\\d+\\.\\d+\\.\\d+)\\.tgz$/.exec(u.pathname);
      if (m && PNPM[m[1]]) return bytes(PNPM[m[1]].tgz);
      if (u.pathname === '/pnpm') {
        const base = 'https://' + u.host + '/';
        const versions = {};
        for (const [v, p] of Object.entries(PNPM)) versions[v] = { name: 'pnpm', version: v, bin: { pnpm: 'bin/pnpm.cjs' }, dist: { tarball: base + 'pnpm/-/pnpm-' + v + '.tgz', integrity: p.integrity } };
        return json({ name: 'pnpm', 'dist-tags': { latest: '99.0.0' }, time: { '12.9.1': '2026-07-01T00:00:00.000Z', '99.0.0': '2026-01-01T00:00:00.000Z' }, versions });
      }
    }
    if (u.host !== 'registry.test') return { status: 502, body: 'unreachable' };
    if (u.pathname === '/tiny/-/tiny-1.0.0.tgz') {
      const bin = atob(TINY.tgz);
      return { headers: [['content-type', 'application/octet-stream']], body: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
    }
    if (u.pathname === '/tiny') return json({ name: 'tiny', 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name: 'tiny', version: '1.0.0', main: 'index.js', dist: { tarball: BASE + 'tiny/-/tiny-1.0.0.tgz', integrity: TINY.integrity } } } });
    return { status: 404, headers: [['content-type', 'application/json']], body: '{"error":"not found"}' };
  }`,
};

export default async function (ctx) {
  const { run, assert, serve } = ctx;
  await ctx.addUser({ name: 'bob' });
  await serve(registry);
  const sh = (s, env = {}) => run(['bash', '-c', s], { cwd: '/home/bob', user: 'bob', env });
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout.slice(-1000)}\n--- stderr\n${r.stderr.slice(-1500)}`;
  const mk = (d) => `rm -rf ${d} && mkdir -p ${d} && cd ${d} && echo '{"name":"p","version":"1.0.0","packageManager":"pnpm@12.9.1"}' > package.json`;

  for (const [what, script, env] of [
    ['--registry', `${mk('a')} && pnpm add tiny --registry ${REGISTRY}`, {}],
    ['a project .npmrc', `${mk('b')} && echo registry=${REGISTRY} > .npmrc && pnpm add tiny`, {}],
    ['npm_config_registry', `${mk('c')} && pnpm add tiny`, { npm_config_registry: REGISTRY }],
  ]) {
    const r = await sh(script, env);
    assert.equal(r.status, 1, `${what} alone doesn't choose where pnpm itself comes from: ${out(r)}`);
    assert.match(r.stderr, /ERR_PNPM_BAD_CONFIG_DEP/, `${what}: ${out(r)}`);
  }
  for (const [what, script, env] of [
    ['pnpm_config_registry', `${mk('d')} && pnpm add tiny`, { pnpm_config_registry: REGISTRY }],
    ['~/.npmrc', `echo registry=${REGISTRY} > ~/.npmrc && ${mk('e')} && pnpm add tiny; rc=$?; rm ~/.npmrc; exit $rc`, {}],
    ['pnpm config set registry', `pnpm config set registry ${REGISTRY} && ${mk('f')} && pnpm add tiny; rc=$?; pnpm config delete registry; exit $rc`, {}],
  ]) {
    const r = await sh(script, env);
    assert.equal(r.status, 0, `${what} names the registry pnpm's pin resolves from: ${out(r)}`);
    const dir = { pnpm_config_registry: 'd', '~/.npmrc': 'e', 'pnpm config set registry': 'f' }[what];
    const lock = await sh(`cat ${dir}/pnpm-lock.yaml`);
    assert.match(lock.stdout, /packageManagerDependencies:[\s\S]*pnpm[\s\S]*12\.9\.1/, `${what}: the lockfile pins pnpm 12.9.1: ${lock.stdout.slice(0, 800)}`);
    assert.match(lock.stdout, /tiny/, `${what}: tiny is installed`);
  }
  console.log('pinned-registry: a pinned project resolves pnpm from the user\'s registry (~/.npmrc, pnpm config, pnpm_config_registry), not from --registry or the project .npmrc (upstream)');
}
