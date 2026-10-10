/**
 * wasix-gnupg file modes (homescoop#169): built on wasix-sysroot
 * 2025.9.30-16, whose libc sets and reads modes through slicc-kernel's
 * slicc_fs imports (1.35.1). gpg creates its default homedir 700,
 * private-keys-v1.d 700 and every secret file 600, as on Linux, and its
 * "unsafe permissions" check sees a 755 homedir.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const H = '/home/gpg-modes';
  const G = `${H}/.gnupg`;
  assert.equal((await run(['mkdir', '-p', H], { cwd: '/home' })).status, 0);
  const sh = (script) => run(['bash', '-c', `export HOME=${H}; unset GNUPGHOME; ${script}`], { cwd: H });
  const ok = async (script) => {
    const r = await sh(script);
    assert.equal(r.status, 0, `${script}: rc=${r.status} stderr=${r.stderr}`);
    return r;
  };
  const modes = async (...paths) => {
    const r = await ok(`stat -c '%a %n' ${paths.join(' ')}`);
    return Object.fromEntries(r.stdout.trim().split('\n').map((l) => l.split(' ')).map(([m, p]) => [p.slice(G.length + 1) || '.', m]));
  };

  // gpg creates the default homedir itself (under umask 022).
  const first = await ok('gpg --batch --list-keys');
  assert.match(first.stderr, /directory '.*\/\.gnupg' created/);
  await ok('gpg --batch --pinentry-mode loopback --passphrase "" --quick-gen-key "Modes <modes@example.org>" default default never');

  const keys = (await ok(`ls ${G}/private-keys-v1.d`)).stdout.trim().split('\n');
  assert.equal(keys.length, 2, `two key files: ${keys}`);
  const revs = (await ok(`ls ${G}/openpgp-revocs.d`)).stdout.trim().split('\n');
  const got = await modes(
    G,
    `${G}/private-keys-v1.d`,
    ...keys.map((k) => `${G}/private-keys-v1.d/${k}`),
    `${G}/trustdb.gpg`,
    `${G}/pubring.kbx`,
    `${G}/openpgp-revocs.d`,
    `${G}/openpgp-revocs.d/${revs[0]}`,
  );
  assert.deepEqual(got, {
    '.': '700',
    'private-keys-v1.d': '700',
    [`private-keys-v1.d/${keys[0]}`]: '600',
    [`private-keys-v1.d/${keys[1]}`]: '600',
    'trustdb.gpg': '600',
    // GnuPG creates the public keybox with the umask, 644 on Linux too.
    'pubring.kbx': '644',
    'openpgp-revocs.d': '700',
    [`openpgp-revocs.d/${revs[0]}`]: '600',
  });

  // The homedir check reads the mode back: 700 is quiet, 755 is unsafe.
  assert.doesNotMatch((await ok('gpg --batch --list-keys')).stderr, /unsafe/);
  const loose = await ok(`chmod 755 ${G}; gpg --batch --list-keys`);
  assert.match(loose.stderr, /WARNING: unsafe permissions on homedir '.*\/\.gnupg'/);
  await ok(`chmod 700 ${G}`);
  await ok('gpgconf --kill gpg-agent');
}
