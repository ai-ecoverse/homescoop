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
add('x_pacquet-stage_1_2_3', '1.0.0', 3);
add('x_pacquet-stage_1_2_3', '2.0.0', 3);

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
  const REAL = 'x_pacquet-stage_1_2_3';
  const manifest = (v) => JSON.stringify({ name: 'swap', version: '1.0.0', private: true, dependencies: { big: v, [REAL]: v } });
  const flow = async (app, md, flags) => {
    const tag = `[${md}]`;
    await write(`${app}/package.json`, manifest('1.0.0'));
    await run(['chown', '-R', 'bob', app], { cwd: '/' });
    const sh = (s) => run(['bash', '-c', s], { cwd: app, user: 'bob' });
    const install = () => sh(`pnpm install --registry ${REGISTRY} ${flags}`);
    const version = async (pkg) => {
      const r = await sh(`shopt -s nullglob; d=${md}/${pkg}; f=("$d"/lib/*); v=; [ -f $d/package.json ] && { read -r v < $d/package.json; v=\${v#*version?:?}; v=\${v%%[!0-9.]*}; }; echo "\${#f[@]} \${v:-nopj}"`);
      return r.stdout.trim();
    };
    const state = () => version('big');
    const real = async () => (await version(REAL)).split(' ')[1];
    const stages = async () => (await sh(`shopt -s nullglob; for f in ${md}/*_pacquet-stage_* ${md}/@*/*_pacquet-stage_*; do echo "\${f#${md}/}"; done`)).stdout.trim().split('\n').filter((n) => n && n !== REAL);
    let r = await install();
    assert.equal(r.status, 0, `${tag} install big@1.0.0: ${out(r)}`);
    assert.equal(await state(), '40 1.0.0', `${tag} big@1.0.0 is installed`);
    assert.equal(await real(), '1.0.0', `${tag} ${REAL}@1.0.0, a real package named like a stage directory, is installed`);
    r = await sh(`mkdir ${md}/big/lockd && echo x > ${md}/big/lockd/x && chmod 500 ${md}/big/lockd`);
    assert.equal(r.status, 0, out(r));
    await write(`${app}/package.json`, manifest('2.0.0'));
    await run(['chown', 'bob', `${app}/package.json`], { cwd: '/' });
    r = await install();
    const after = await state();
    console.log(`swap-edges: ${tag} update over an unremovable entry: rc ${r.status}, big is "${after}"`);
    assert.ok(after === '40 1.0.0' || after === '50 2.0.0', `#1384 ${tag} big is a complete 1.0.0 or 2.0.0 after the update (rc ${r.status}), not "${after}": ${out(r)}`);
    if (after === '40 1.0.0') {
      const x = await sh(`cat ${md}/big/lockd/x`);
      assert.equal(x.stdout, 'x\n', `#1384 ${tag} the old tree is the old tree, read-only entry included`);
    }
    if (after === '50 2.0.0') {
      const left = await stages();
      console.log(`swap-edges: ${tag} leftovers after the update: ${left.join(' ') || 'none'}`);
      assert.equal(left.length, 1, `${tag} the unremovable old tree is left once: ${left.join(' ')}`);
      assert.match(r.stderr, new RegExp(`${md}/${left[0]}`), `#1532 ${tag} the update names the leftover ${left[0]} on stderr: ${out(r)}`);
      assert.equal(await real(), '2.0.0', `#1532 ${tag} ${REAL} is updated, not taken for a leftover`);
      r = await install();
      assert.equal(r.status, 0, `${tag} an install while the leftover is still read-only: ${out(r)}`);
      assert.match(r.stderr, new RegExp(`${md}/${left[0]}`), `#1532 ${tag} an install that still can't delete it names it again: ${out(r)}`);
      assert.deepEqual(await stages(), left, `${tag} and leaves it`);
    }
    r = await sh(`chmod -R u+w . && pnpm install --registry ${REGISTRY} ${flags} && ls -A ${md}`);
    assert.equal(r.status, 0, `${tag} the update after chmod -R u+w: ${out(r)}`);
    assert.equal(await state(), '50 2.0.0', `${tag} big@2.0.0 is installed after the retry`);
    console.log(`swap-edges: ${tag} after the retry: ${r.stdout.trim().split('\n').join(' ')}`);
    assert.deepEqual(await stages(), [], `#1532 ${tag} the install after chmod -R u+w removes the leftover: ${out(r)}`);
    r = await sh(`ls -A ${md}`);
    assert.ok(!r.stdout.includes('.pacquet-stage-leftovers'), `#1532 ${tag} and its record: ${r.stdout}`);
    assert.equal(await real(), '2.0.0', `#1532 ${tag} ${REAL} survives every install`);
    return sh;
  };

  const sh = await flow('/home/bob/swap', 'node_modules', '');
  let r = await sh('mkdir -p node_modules/old_pacquet-stage_1_2_3/lib && echo x > node_modules/old_pacquet-stage_1_2_3/lib/a.js');
  assert.equal(r.status, 0, out(r));
  r = await sh(`pnpm install --registry ${REGISTRY}`);
  assert.equal(r.status, 0, `an install over an unrecorded stage-named directory: ${out(r)}`);
  r = await sh('cat node_modules/old_pacquet-stage_1_2_3/lib/a.js');
  assert.equal(r.stdout, 'x\n', '#1532 an unrecorded directory is never deleted, whatever its name');

  const sh2 = await flow('/home/bob/swap2', 'www/mods', '--config.modules-dir=www/mods');
  r = await sh2(`mkdir -p mods/y_pacquet-stage_1_2_3 && echo y > mods/y_pacquet-stage_1_2_3/a.js && pnpm install --registry ${REGISTRY} --config.modules-dir=www/mods && cat mods/y_pacquet-stage_1_2_3/a.js`);
  assert.equal(r.status, 0, `#1532 a custom modulesDir: a stage-named directory outside it survives an install: ${out(r)}`);
  assert.equal(r.stdout.trim().split('\n').pop(), 'y', `#1532 ${out(r)}`);
}
