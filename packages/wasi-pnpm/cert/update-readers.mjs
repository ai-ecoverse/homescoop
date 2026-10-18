/**
 * A package replaced in a hoisted node_modules is never seen half there
 * (12.9.1-11, patches/0004, homescoop#1128). bob installs big@1.0.0 (240
 * files), then updates to big@2.0.0 (260 files) and adds fresh@1.0.0 (200
 * files) while a second process polls both directories with bash builtins
 * only. Every observation must be "absent" or a complete version: a
 * directory with the wrong file count, or without its package.json, is the
 * upstream window (stage_and_swap removed the old tree file by file before
 * renaming the new one in), which a running agent reading its own package
 * during an update fell into.
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
add('big', '1.0.0', 240);
add('big', '2.0.0', 260);
add('fresh', '1.0.0', 200);

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

// One observation per pass: "<pkg> absent" or "<pkg> <files in lib/> <version|nopj>".
// A sample reads package.json, lists lib/, then reads package.json again
// and checks the directory is still there. If those disagree, the update
// moved the directory during the sample (the reader raced a rename, which
// is fine): "torn". Otherwise it is "<pkg> <files in lib/> <version|nopj>".
const POLL = [
  'shopt -s nullglob',
  'pjof() { local pj=; PJ=nopj; if [[ -f $1/package.json ]] && { read -r pj || [[ -n $pj ]]; } < "$1/package.json"; then pj=${pj#*version?:?}; PJ=${pj%%[!0-9.]*}; fi; }',
  'look() {',
  '  local d=node_modules/$1 a b',
  '  if [[ ! -d $d ]]; then echo "$1 absent"; return; fi',
  '  pjof "$d"; a=$PJ',
  '  local f=("$d"/lib/*)',
  '  pjof "$d"; b=$PJ',
  '  if [[ $a != "$b" || ! -d $d ]]; then echo "$1 torn"; return; fi',
  '  echo "$1 ${#f[@]} $a"',
  '}',
  'while [[ ! -e /tmp/upd-done ]]; do look big; look fresh; done',
  '',
].join('\n');

export default async function (ctx) {
  const { run, write, read, assert, addUser, serve } = ctx;
  const out = (r) => `rc=${r.status}\n--- stdout\n${r.stdout.slice(-3000)}\n--- stderr\n${r.stderr.slice(-3000)}`;
  await serve(registry);
  await addUser({ name: 'bob' });
  const app = '/home/bob/upd';
  const manifest = (deps) => JSON.stringify({ name: 'upd', version: '1.0.0', private: true, dependencies: deps });
  await write(`${app}/package.json`, manifest({ big: '1.0.0' }));
  await run(['chown', '-R', 'bob', app], { cwd: '/' });
  const first = await run(['pnpm', 'install', '--registry', REGISTRY], { cwd: app, user: 'bob' });
  assert.equal(first.status, 0, `install big@1.0.0: ${out(first)}`);

  await write('/tmp/upd-poll.sh', POLL);
  await write(`${app}/package.json.next`, manifest({ big: '2.0.0', fresh: '1.0.0' }));
  await run(['chown', 'bob', `${app}/package.json.next`], { cwd: '/' });
  const r = await run(['bash', '-c', [
    'rm -f /tmp/upd-done /tmp/upd-obs',
    'bash /tmp/upd-poll.sh > /tmp/upd-obs & P=$!',
    // Let the poller see the old version first.
    'sleep 1',
    'mv package.json.next package.json',
    `pnpm install --registry ${REGISTRY}; rc=$?`,
    'touch /tmp/upd-done; wait $P',
    'exit $rc',
  ].join('\n')], { cwd: app, user: 'bob' });
  assert.equal(r.status, 0, `update to big@2.0.0 + fresh@1.0.0: ${out(r)}`);

  const obs = (await read('/tmp/upd-obs')) ?? '';
  const counts = {};
  for (const line of obs.split('\n').filter(Boolean)) counts[line] = (counts[line] ?? 0) + 1;
  const ok = new Set(['big absent', 'big torn', 'big 240 1.0.0', 'big 260 2.0.0', 'fresh absent', 'fresh torn', 'fresh 200 1.0.0']);
  const bad = Object.entries(counts).filter(([k]) => !ok.has(k));
  const good = Object.entries(counts).filter(([k]) => ok.has(k)).map(([k, v]) => `${k}: ${v}`);
  const partial = {};
  for (const [k, v] of bad) {
    const [pkg, n, ver] = k.split(' ');
    const p = (partial[pkg] ??= { obs: 0, min: Infinity, max: -Infinity, nopj: 0 });
    p.obs += v;
    p.min = Math.min(p.min, Number(n));
    p.max = Math.max(p.max, Number(n));
    if (ver === 'nopj') p.nopj += v;
  }
  const summary = [...good, ...Object.entries(partial).map(([pkg, p]) => `${pkg} HALF THERE: ${p.obs} (lib/ ${p.min}-${p.max} files, ${p.nopj} without package.json)`)].join(', ');
  console.log(`update-readers: ${summary}`);
  assert.ok((counts['big 240 1.0.0'] ?? 0) > 0 && (counts['big 260 2.0.0'] ?? 0) > 0, `the poller saw big's old and new versions: ${summary}`);
  assert.deepEqual(bad, [], `a reader saw a package half there (dir with the wrong file count or no package.json): ${summary}`);

  const ls = await run(['bash', '-c', 'shopt -s nullglob; f=(node_modules/big/lib/*); g=(node_modules/fresh/lib/*); s=(node_modules/*pacquet-stage*); echo "${#f[@]} ${#g[@]} ${#s[@]}"'], { cwd: app, user: 'bob' });
  assert.equal(ls.stdout.trim(), '260 200 0', `after the update: big 260 files, fresh 200, no staging dirs left: ${out(ls)}`);
}
