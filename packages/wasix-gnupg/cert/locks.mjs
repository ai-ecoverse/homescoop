/**
 * Lock files under users enforce (2.4.9-10).
 *
 * 1. homescoop#955: an empty keyring in a directory the caller can't write
 *    (root's 755 /srv/ro) is listed by cone with rc 0 and no "can't create
 *    …lock" error. 2.4.9-9 probes short keyrings under their dotlock, and
 *    dotlock logs "Permission denied" (rc 2).
 * 2. homescoop#888: root runs gpg -k and gpg-connect-agent on cone's
 *    homedir. Afterwards cone can still generate a key, sign and update the
 *    trustdb, and every lock file in the homedir is cone's. 2.4.9-8 and -9
 *    leave root-owned 0644 lock files that cone can't open for writing.
 *    A root-owned lock file left by an older gpg is replaced by cone's gpg.
 *    A lock name cone points at a root file (a symlink) doesn't make root's
 *    gpg give that file to cone: only lock files it creates are given away.
 * 3. homescoop#881: gpgconf --lock / --unlock say they aren't supported on
 *    WASI, never "invalid size of lockfile".
 */
const GEN = (uid) => `gpg --batch --pinentry-mode loopback --passphrase "" --quick-gen-key "${uid}" ed25519 sign never`;

export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const sh = async (user, script) => {
    const r = await run(['bash', '-c', script], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    return r.stdout + r.stderr;
  };

  // 1. An empty keyring in a read-only directory.
  await sh('root', 'mkdir -p /srv/ro; : > /srv/ro/empty.gpg; chmod 755 /srv/ro; chmod 644 /srv/ro/empty.gpg');
  const ro = await sh('cone', [
    'mkdir -m 700 -p ~/gh',
    'gpg --homedir ~/gh --no-default-keyring --keyring /srv/ro/empty.gpg --list-keys; echo "rc=$?"',
    'ls /srv/ro; gpgconf --homedir ~/gh --kill gpg-agent',
  ].join('\n'));
  assert.match(ro, /^rc=0$/m, `cone lists an empty keyring in root's 755 directory (2.4.9-9: rc 2):\n${ro}`);
  assert.doesNotMatch(ro, /Permission denied|can't create/, `no lock error:\n${ro}`);
  assert.doesNotMatch(ro, /empty\.gpg\.lock/, `no lock file in the read-only directory:\n${ro}`);

  // 2. Root uses cone's homedir, then cone carries on.
  const h = '/home/cone/h';
  const setup = await sh('cone', [
    `export GNUPGHOME=${h}; rm -rf $GNUPGHOME; mkdir -m 700 $GNUPGHOME`,
    `${GEN('C <c@example.org>')} > /dev/null 2>&1; echo "gen=$?"`,
    'gpgconf --kill gpg-agent; for f in pubring.kbx trustdb.gpg gnupg_spawn_agent_sentinel; do rm -f $GNUPGHOME/$f.lock; done; ls $GNUPGHOME',
  ].join('\n'));
  assert.doesNotMatch(setup, /\.lock$/m, `no lock files before root's run, as in a homedir from 2.4.9-7:\n${setup}`);
  assert.match(setup, /^gen=0$/m, `cone's first key:\n${setup}`);
  const asRoot = await sh('root', [
    `gpg --homedir ${h} --batch -k > /dev/null 2>&1; echo "k=$?"`,
    `gpg-connect-agent --homedir ${h} /bye > /dev/null 2>&1; echo "agent=$?"`,
    `gpgconf --homedir ${h} --kill gpg-agent`,
    `for f in pubring.kbx trustdb.gpg gnupg_spawn_agent_sentinel; do [ -e ${h}/$f.lock ] && stat -c "%n %U %a" ${h}/$f.lock; done`,
  ].join('\n'));
  assert.match(asRoot, /^k=0$/m, `root lists cone's keys:\n${asRoot}`);
  const locks = [...asRoot.matchAll(/^(\S+\.lock) (\S+) \d+$/gm)];
  assert.ok(locks.length, `root's gpg made lock files in cone's homedir:\n${asRoot}`);
  for (const [line, , owner] of locks) {
    assert.equal(owner, 'cone', `root's gpg gives the lock files it creates in cone's homedir to cone (2.4.9-9: root 644): ${line}\n${asRoot}`);
  }
  const after = await sh('cone', [
    `export GNUPGHOME=${h}`,
    `${GEN('C2 <c2@example.org>')} 2>&1; echo "gen=$?"`,
    'echo hi | gpg --batch --pinentry-mode loopback --passphrase "" --local-user c2@example.org --clearsign > /dev/null 2>&1; echo "sign=$?"',
    'gpg --batch --update-trustdb 2>&1; echo "trustdb=$?"',
    'gpgconf --kill gpg-agent',
  ].join('\n'));
  for (const step of ['gen', 'sign', 'trustdb']) {
    assert.match(after, new RegExp(`^${step}=0$`, 'm'), `cone's ${step} after root used the homedir (2.4.9-9: Permission denied / No agent running):\n${after}`);
  }
  assert.doesNotMatch(after, /Permission denied|can't (allocate|create) lock|No agent running/, `cone: no lock errors:\n${after}`);

  // A lock name that cone points at a root file: root's gpg must not give
  // the target away (only a lock file it creates itself is cone's).
  await sh('root', 'mkdir -p /srv/t; echo secret > /srv/t/f; chmod 755 /srv/t; chmod 644 /srv/t/f');
  const planted = await sh('cone', `rm -f ${h}/pubring.kbx.lock ${h}/trustdb.gpg.lock; ln -s /srv/t/f ${h}/pubring.kbx.lock; ln -s /srv/t/f ${h}/trustdb.gpg.lock; ls -l ${h}/pubring.kbx.lock`);
  assert.match(planted, /pubring\.kbx\.lock -> \/srv\/t\/f/, `planted a symlink:\n${planted}`);
  const viaLink = await sh('root', [
    `gpg --homedir ${h} --batch -k > /dev/null 2>&1; echo "k=$?"`,
    `gpgconf --homedir ${h} --kill gpg-agent`,
    'stat -c "target %U %a" /srv/t/f',
  ].join('\n'));
  assert.match(viaLink, /^target root 644$/m, `root's gpg leaves a symlinked lock file's target alone (2.4.9-10 before the fix: cone 644):\n${viaLink}`);
  await sh('cone', `rm -f ${h}/pubring.kbx.lock ${h}/trustdb.gpg.lock`);

  // A root-owned lock file that an older gpg left behind.
  const stale = await sh('root', `rm -f ${h}/pubring.kbx.lock; : > ${h}/pubring.kbx.lock; chmod 644 ${h}/pubring.kbx.lock; stat -c "%U %a" ${h}/pubring.kbx.lock`);
  assert.match(stale, /^root 644$/m, `planted a root-owned lock file:\n${stale}`);
  const reclaim = await sh('cone', [
    `export GNUPGHOME=${h}`,
    `${GEN('C3 <c3@example.org>')} 2>&1; echo "gen=$?"`,
    'stat -c "%U" $GNUPGHOME/pubring.kbx.lock',
    'gpg --batch --with-colons -k | while IFS=: read -r t _ _ _ _ _ _ _ _ u _; do [ "$t" = uid ] && echo "uid $u"; done',
    'gpgconf --kill gpg-agent',
  ].join('\n'));
  assert.match(reclaim, /^gen=0$/m, `cone replaces an unlocked root-owned pubring.kbx.lock:\n${reclaim}`);
  assert.match(reclaim, /^cone$/m, `pubring.kbx.lock is cone's now:\n${reclaim}`);
  for (const uid of ['C <c@example.org>', 'C2 <c2@example.org>', 'C3 <c3@example.org>']) {
    assert.ok(reclaim.includes(`uid ${uid}`), `cone keeps ${uid}:\n${reclaim}`);
  }

  // 3. gpgconf --lock / --unlock.
  const gl = await sh('cone', [
    `export GNUPGHOME=${h}`,
    'gpgconf --lock pubring.kbx; echo "lock=$?"',
    'gpgconf --unlock pubring.kbx; echo "unlock=$?"',
  ].join('\n'));
  assert.doesNotMatch(gl, /invalid size of lockfile|cannot read lockfile|release_dotlock/, `no lockfile format error (2.4.9-9: invalid size of lockfile):\n${gl}`);
  assert.match(gl, /--lock '[^']*pubring\.kbx': not supported on WASI/, `gpgconf --lock says it isn't supported:\n${gl}`);
  assert.match(gl, /--unlock '[^']*pubring\.kbx': not supported on WASI/, `gpgconf --unlock says it isn't supported:\n${gl}`);
  assert.doesNotMatch(gl, /^lock=0$/m, `gpgconf --lock fails:\n${gl}`);
  console.log('locks: an empty keyring in a read-only directory lists with rc 0 (#955); after root uses cone\'s homedir its lock files are cone\'s and cone generates, signs and updates the trustdb, and an unlocked root-owned lock file is replaced (#888); gpgconf --lock/--unlock say they are not supported on WASI (#881)');
}
