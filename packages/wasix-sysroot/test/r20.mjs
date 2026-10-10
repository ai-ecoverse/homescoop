/**
 * wasix-sysroot 2025.9.30-20 (homescoop#207): test/r20.c as root (the
 * kernel's default) and as a user added with kernel.users.add. Needs
 * slicc-kernel K1 (slicc-kernel#251). On -18 every process is uid 1000
 * "user" with home /home/user; on a kernel without K1, -20's getters return
 * -1 and the setters fail with ENOSYS (cert/NEGATIVE.md).
 */
export default async function (ctx) {
  const { run, kernel, assert } = ctx;
  assert.ok(kernel.users, 'this kernel has no users (needs slicc-kernel K1)');
  const cone = await kernel.users.add({ name: 'cone' });
  assert.equal(cone.uid, 1000);
  const want = {
    root: [
      'ids: uid=0 euid=0 gid=0 egid=0 res=0:0/0,0,0/0,0,0',
      'groups: n=1 m=1 0 small=-2 errno=0',
      'pwuid: root /root /bin/bash',
      'grgid: root',
      'pwnam root: uid=0 dir=/root',
      'pwnam 1000: no static user',
      'seteuid 1000: uid=0 euid=1000 gid=0 egid=0 res=0:0/0,1000,0/0,0,0',
      'root seteuid: 0 0 errno=0 euid=0',
      'root setgroups: 0 count=2',
      'root drop: 0 setuid0=-1 errno=EPERM',
      'dropped: uid=1000 euid=1000 gid=0 egid=0 res=0:0/1000,1000,1000/0,0,0',
      'r20 done',
    ],
    cone: [
      'ids: uid=1000 euid=1000 gid=1000 egid=1000 res=0:0/1000,1000,1000/1000,1000,1000',
      'groups: n=2 m=2 1000 100 small=-1 errno=28',
      'pwuid: cone /home/cone /bin/bash',
      'grgid: cone',
      'pwnam root: uid=0 dir=/root',
      'pwnam 1000: no static user',
      'user setuid0: -1 errno=EPERM',
      'user setgroups: -1 errno=EPERM',
      'user setuid self: 0',
      'r20 done',
    ],
  };
  for (const user of ['root', 'cone']) {
    const r = await run(['r20'], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    assert.equal(r.status, 0, `${user}: r20 rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split('\n'), want[user], `${user}:\n${r.stdout}`);
  }
}
