/**
 * wasix-openssh 10.6.0-6 (wasix-sysroot -20+ credentials, built on -22):
 * keys as root and as an added user. For each: the default user and ~ come
 * from the kernel's passwd (OpenSSH uses getpwuid, not $USER); ssh-keygen
 * writes a 0600 key owned by that user; ssh logs in with ~/.ssh/id_ecdsa
 * (~ expanded from pw_dir; -F /dev/null so root's cert config and seeded
 * id_ed25519 stay out) and records the host in that user's own
 * known_hosts; a private key readable by others is refused ("UNPROTECTED
 * PRIVATE KEY FILE").
 */
export default async function users(ctx) {
  const { assert, runAs, addUser, authorize, hostUser } = ctx;
  const cone = await addUser({ name: 'cone' });
  for (const [user, home, uid] of [['root', '/root', '0'], ['cone', '/home/cone', String(cone?.uid ?? 1000)]]) {
    const as = (argv, o) => runAs(user, argv, o);
    const ok = async (argv, what) => {
      const r = await as(argv);
      assert.equal(r.status, 0, `${user}: ${what}: rc=${r.status} ${r.stderr}`);
      return r.stdout;
    };
    const g = await ok(['ssh', '-F', '/dev/null', '-G', 'example.invalid'], 'ssh -G');
    assert.match(g, new RegExp(`^user ${user}$`, 'm'), `${user}: default user: ${g.slice(0, 200)}`);
    assert.match(g, new RegExp(`^userknownhostsfile ${home}/\\.ssh/known_hosts`, 'm'), `${user}: ~ is ${home}`);

    const key = `${home}/.ssh/id_ecdsa`;
    await ok(['mkdir', '-p', '-m', '700', `${home}/.ssh`], 'mkdir ~/.ssh');
    await ok(['ssh-keygen', '-q', '-t', 'ecdsa', '-N', '', '-C', `${user}@slicc`, '-f', key], 'ssh-keygen');
    const st = (await ok(['stat', '-c', '%u %a', key, `${key}.pub`], 'stat keys')).trim().split('\n');
    assert.deepEqual(st, [`${uid} 600`, `${uid} 644`], `${user}: key owner/mode`);
    authorize(await ok(['cat', `${key}.pub`], 'cat pub'));

    const login = ['ssh', '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'IdentitiesOnly=yes', '-i', '~/.ssh/id_ecdsa', `${hostUser}@sshd.cert.internal`];
    const out = await ok([...login, 'echo', `hi-${user}`], 'ssh -i ~/.ssh/id_ecdsa');
    assert.equal(out.trim(), `hi-${user}`);
    const kh = (await ok(['stat', '-c', '%u', `${home}/.ssh/known_hosts`], 'known_hosts')).trim();
    assert.equal(kh, uid, `${user}: known_hosts owner`);

    await ok(['chmod', '644', key], 'chmod 644');
    const open = await as([...login, 'true']);
    assert.notEqual(open.status, 0, `${user}: a 0644 private key was used`);
    assert.match(open.stderr, /UNPROTECTED PRIVATE KEY FILE/, `${user}: ${open.stderr}`);
    await ok(['chmod', '600', key], 'chmod 600');
    console.log(`users: ${user} (uid ${uid}, ${home}): ssh -G user/~, keygen 600, login with ~/.ssh/id_ecdsa, own known_hosts, 0644 key refused`);
  }
}
