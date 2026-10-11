export const kernelOptions = { users: process.env.R24_USERS || 'report' };

const want = {
  owners: {
    root: [
      'new: 0:0',
      'chown: 0 owner=1000:1000',
      'lchown: 0 owner=1000:100',
      'lchown target: 1000:1000',
      'fchown: 0 owner=0:1000',
      'fchownat cwd: 0 owner=0:0',
      'fchownat nofollow: 0 owner=1000:100',
      'fchownat badflag: -1 EINVAL',
      'missing: -1 ENOENT',
      'fchown closed: -1 EBADF',
      'r24 root done',
    ],
    cone: [
      'new: 1000:1000',
      'give away: -1 EPERM owner=1000:1000',
      'own group: 0 owner=1000:100',
      'foreign group: -1 EPERM owner=1000:100',
      'root file: 0:0',
      'r24 user done',
    ],
  },
  off: {
    root: [
      'new: 0:0',
      'chown: 0 owner=0:0',
      'lchown: 0 owner=0:0',
      'lchown target: 0:0',
      'fchown: 0 owner=0:0',
      'fchownat cwd: 0 owner=0:0',
      'fchownat nofollow: 0 owner=0:0',
      'fchownat badflag: -1 EINVAL',
      'missing: -1 ENOENT',
      'fchown closed: -1 EBADF',
      'r24 root done',
    ],
    cone: [
      'new: 1000:1000',
      'give away: 0 owner=1000:1000',
      'own group: 0 owner=1000:1000',
      'foreign group: 0 owner=1000:1000',
      'root file: 1000:1000',
      'r24 user done',
    ],
  },
  absent: {
    root: [
      'new: 0:0',
      'chown: -1 ENOSYS owner=0:0',
      'lchown: -1 ENOSYS owner=0:0',
      'lchown target: 0:0',
      'fchown: 0 owner=0:0',
      'fchownat cwd: 0 owner=0:0',
      'fchownat nofollow: -1 ENOSYS owner=0:0',
      'fchownat badflag: -1 EINVAL',
      'missing: -1 ENOSYS',
      'fchown closed: -1 ENOSYS',
      'r24 root done',
    ],
    cone: [
      'new: 1000:1000',
      'give away: 0 owner=1000:1000',
      'own group: -1 ENOSYS owner=1000:1000',
      'foreign group: 0 owner=1000:1000',
      'root file: 1000:1000',
      'r24 user done',
    ],
  },
};

export default async function (ctx) {
  const { run, kernel, assert, requireNative } = ctx;
  assert.ok(kernel.users, 'this kernel has no users (needs slicc-kernel K1)');
  await kernel.users.add({ name: 'cone' });
  const mode = !requireNative ? 'absent' : kernel.users.mode === 'off' ? 'off' : 'owners';
  for (const user of ['root', 'cone']) {
    const r = await run(['r24', user === 'cone' ? 'user' : 'root'], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    assert.equal(r.status, 0, `${user}: rc=${r.status} ${r.stdout}${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split('\n'), want[mode][user], `${mode} ${user}:\n${r.stdout}`);
  }
  console.log(`r24: chown/lchown/fchown/fchownat and stat owners as root and cone, ${mode} (users ${kernel.users.mode ?? 'n/a'})`);
}
