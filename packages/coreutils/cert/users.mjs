/**
 * H1 (homescoop#207): coreutils names users and groups from slicc-kernel's
 * process credentials (shims/slicc/slicc_libc_gaps.c over
 * Module.sliccKernel.cred(); slicc-kernel >= 1.44.0) and its /etc/passwd and
 * /etc/group (slicc_pwd.c, now linked with --wrap and with getgrent), as root
 * and as a user added with kernel.users.add.
 *
 * On 9.12.0-4 (the negative, NEGATIVE.md) everyone is uid 1000 and no name
 * resolves: `id` says uid=1000 without a name, whoami "cannot find name for
 * user ID 1000". File owners are the kernel's: 1.47.1 reports the caller's
 * ids (1.44.0 reported 1000 for every file).
 */
export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  const cone = await addUser({ name: 'cone' });
  assert.equal(cone.uid, 1000, JSON.stringify(cone));

  const script = 'id; id -un; id -G; whoami; groups; groups cone; logname';
  const want = {
    root: [
      'uid=0(root) gid=0(root) groups=0(root)',
      'root',
      '0',
      'root',
      'root',
      'cone : cone users',
      'root',
    ],
    cone: [
      'uid=1000(cone) gid=1000(cone) groups=1000(cone),100(users)',
      'cone',
      '1000 100',
      'cone',
      'cone users',
      'cone : cone users',
      'cone',
    ],
  };
  for (const user of ['root', 'cone']) {
    const r = await run(['bash', '-c', script], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    assert.equal(r.status, 0, `${user}: ${r.stdout}${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split('\n'), want[user], `${user}:\n${r.stdout}${r.stderr}`);
    assert.equal(r.stderr, '', `${user}: ${r.stderr}`);
  }

  // slicc-kernel >= 1.47.1 reports a file's owner as the caller's ids: root
  // sees root's file as root's.
  const rf = await run(['bash', '-c', 'cd ~ && touch made && ls -l made | cut -d" " -f3,4 && stat -c "%U:%G %u:%g" made'], { cwd: '/tmp' });
  assert.equal(rf.status, 0, `${rf.stdout}${rf.stderr}`);
  assert.deepEqual(rf.stdout.trim().split('\n'), ['root root', 'root:root 0:0'], rf.stdout + rf.stderr);

  // A file the user creates in their home: ls -l and stat name its owner.
  const f = await run(['bash', '-c', 'cd ~ && touch made && ls -l made | cut -d" " -f3,4 && stat -c "%U:%G %u:%g" made && ls -ld ~ | cut -d" " -f3,4'], { cwd: '/tmp', user: 'cone' });
  assert.equal(f.status, 0, `${f.stdout}${f.stderr}`);
  assert.deepEqual(f.stdout.trim().split('\n'), ['cone cone', 'cone:cone 1000:1000', 'cone cone'], f.stdout + f.stderr);
}
