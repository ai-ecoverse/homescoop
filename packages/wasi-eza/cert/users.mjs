/**
 * wasi-eza under users enforce: owners and groups by name (0001's
 * /etc/passwd and /etc/group in place of uzers) and by number, the
 * caller's own files and groups highlighted (slicc.cred_get), a 0700 home
 * refused, and a file in it not stat'ed for someone else.
 */
export default async function (ctx) {
  const { run, addUser, assert } = ctx;
  const alice = await addUser({ name: 'alice' });
  const bob = await addUser({ name: 'bob' });
  const out = (r) => `rc=${r.status}\n${r.stdout}${r.stderr}`;
  const setup = await run(['bash', '-c', [
    'mkdir -p /home/bob/pub /home/alice/priv',
    'printf bob > /home/bob/pub/mine && printf shared > /home/bob/pub/theirs',
    'printf alice > /home/alice/priv/secret',
    `chown -R ${bob.uid}:${bob.gid} /home/bob`,
    `chown -R ${alice.uid}:${alice.gid} /home/alice`,
    `chown ${bob.uid}:${alice.gid} /home/bob/pub/theirs`,
    'chmod 755 /home/bob /home/bob/pub && chmod 700 /home/alice && chmod 600 /home/alice/priv/secret',
  ].join(' && ')], { cwd: '/' });
  assert.equal(setup.status, 0, `setup: ${out(setup)}`);
  const eza = (args, user) => run(['eza', ...args], { cwd: '/home', ...(user && { user }) });

  let r = await eza(['-lg', '--no-time', '/home/bob/pub', '/home/alice/priv']);
  assert.equal(r.status, 0, out(r));
  assert.equal(r.stdout, [
    '/home/bob/pub:',
    '.rw-r--r-- 3 bob bob   mine',
    '.rw-r--r-- 6 bob alice theirs',
    '',
    '/home/alice/priv:',
    '.rw------- 5 alice alice secret',
    '',
  ].join('\n'), `root sees every owner by name: ${out(r)}`);

  r = await eza(['-lgn', '--no-time', '/home/bob/pub'], 'alice');
  assert.equal(r.stdout, `.rw-r--r-- 3 ${bob.uid} ${bob.gid} mine\n.rw-r--r-- 6 ${bob.uid} ${alice.gid} theirs\n`, out(r));

  // The theme's "you" style (bold yellow) is the caller's, from cred_get.
  const Y = (s) => `\x1b[1;33m${s}\x1b[0m`;
  r = await eza(['-lg', '--no-time', '--color=always', '/home/bob/pub/mine'], 'bob');
  assert.ok(r.stdout.includes(`${Y('bob')} ${Y('bob')}`), `bob's own user and group: ${JSON.stringify(r.stdout)}`);
  r = await eza(['-lg', '--no-time', '--color=always', '/home/bob/pub/theirs'], 'alice');
  assert.ok(r.stdout.includes(` bob ${Y('alice')} `), `alice's group, bob's user: ${JSON.stringify(r.stdout)}`);
  r = await eza(['-lg', '--no-time', '--color=always', '/home/bob/pub/mine'], 'alice');
  assert.ok(r.stdout.includes(' bob bob '), `nothing of alice's, unstyled: ${JSON.stringify(r.stdout)}`);

  // --smart-group: a group named as the owner shows as ':'.
  r = await eza(['-lg', '--no-time', '--smart-group', '/home/bob/pub'], 'bob');
  assert.equal(r.stdout, '.rw-r--r-- 3 bob :     mine\n.rw-r--r-- 6 bob alice theirs\n', out(r));

  // bob may not read alice's 0700 home, or stat what is in it.
  r = await eza(['-l', '--no-time', '/home/alice'], 'bob');
  assert.equal(r.stdout, '', out(r));
  assert.match(r.stderr, /^Permission denied: \/home\/alice/, out(r));
  r = await eza(['-l', '--no-time', '/home/alice/priv/secret'], 'bob');
  assert.equal(r.status, 2, out(r));
  assert.equal(r.stderr, '"/home/alice/priv/secret": Permission denied (os error 2)\n');
  r = await eza(['-l', '--no-time', '/home/alice/priv'], 'alice');
  assert.equal(r.stdout, '.rw------- 5 alice secret\n', `alice lists her own: ${out(r)}`);
  console.log("users: owners and groups by name and number, the caller's highlighted, alice's 0700 home refused to bob");
}
