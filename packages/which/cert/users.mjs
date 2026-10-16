/**
 * which under users enforce (#687). 2.23.0-2 links the slicc credentials
 * (slicc_cred_js), so which's executable test (stat + its own uid/gid
 * classes) follows the caller's real uid, gid and groups.
 *
 * Scripts on PATH, each `#!/bin/sh`, with mode MMM and owner:
 *   rMMM root:root, oMMM cone:cone (1000:1000), gMMM root:cone (0:1000).
 * root finds every one with any x bit; cone finds only those whose x bit is
 * in cone's class (owner, else group, else other: o007 is not cone's).
 */
const MODES = ['700', '750', '755', '711', '070', '007', '705', '100', '001', '010'];
const CONE = 'r755 r711 r007 r705 r001 o700 o750 o755 o711 o705 o100 g750 g755 g711 g070 g010';

export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const setup = await run(['bash', '-c', [
    'rm -rf /tmp/wu && mkdir -p /tmp/wu/bin && cd /tmp/wu/bin',
    `for m in ${MODES.join(' ')}; do for p in r o g; do printf "#!/bin/sh\\necho $p$m\\n" > $p$m; done; chown 1000:1000 o$m; chown 0:1000 g$m; chmod $m r$m o$m g$m; done`,
    'chmod 755 /tmp/wu /tmp/wu/bin',
  ].join(' && ')], { cwd: '/tmp' });
  assert.equal(setup.status, 0, `setup: ${setup.stderr}`);
  const id = await run(['id'], { user: 'cone' });
  assert.match(id.stdout, /^uid=1000\(cone\) gid=1000\(cone\)/, `cone's id: ${id.stdout}`);

  const env = { PATH: '/tmp/wu/bin:/usr/bin:/bin' };
  const names = ['r', 'o', 'g'].flatMap((p) => MODES.map((m) => p + m));
  const found = async (user) => {
    const hits = [];
    for (const name of names) {
      const r = await run(['which', name], { cwd: '/tmp', env, ...(user && { user }) });
      if (r.status === 0) {
        assert.equal(r.stdout, `/tmp/wu/bin/${name}\n`, `${user ?? 'root'}: which ${name}`);
        hits.push(name);
      } else {
        assert.equal(r.status, 1, `${user ?? 'root'}: which ${name}: rc=${r.status} stderr=${r.stderr}`);
        assert.equal(r.stdout, '', `${user ?? 'root'}: which ${name} (not found) prints nothing on stdout`);
        assert.match(r.stderr, new RegExp(`no ${name} in \\(`), `${user ?? 'root'}: which ${name} stderr`);
      }
    }
    return hits.join(' ');
  };
  assert.equal(await found(), names.join(' '), 'root: which finds every script with any x bit');
  assert.equal(await found('cone'), CONE, "cone: which finds only scripts executable in cone's class");

  const all = await run(['which', '-a', 'r755', 'r700', 'o700'], { cwd: '/tmp', env, user: 'cone' });
  assert.equal(all.status, 1, `cone: which -a r755 r700 o700: rc=${all.status}`);
  assert.equal(all.stdout, '/tmp/wu/bin/r755\n/tmp/wu/bin/o700\n', 'cone: which -a skips root\'s 0700');
  console.log(`users: root's which finds all ${names.length}; cone's finds ${CONE.split(' ').length} (its owner/group/other class)`);
}
