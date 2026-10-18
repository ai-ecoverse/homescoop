/**
 * wasix-python 3.14.2-13 (H1, homescoop#207): ids, pwd and grp come from
 * wasix-sysroot -20's libc (slicc-kernel process credentials and its
 * /etc/passwd, /etc/group) instead of uid/gid-1000 --wrap stubs, as root (the
 * kernel's default) and as a user added with kernel.users.add. File owners are
 * the caller's ids from slicc-kernel 1.47.1.
 *
 * On 3.14.2-12 (the negative) every process is uid 1000 "user" with home
 * /home/user.
 */
const SCRIPT = String.raw`
import os, pwd, grp, getpass, json, pathlib
p = pwd.getpwuid(os.getuid())
f = pathlib.Path.home() / "made"
f.write_text("x")
print(json.dumps([os.getuid(), os.geteuid(), os.getgid(), sorted(os.getgroups()), p.pw_name, p.pw_dir,
                  grp.getgrgid(os.getgid()).gr_name, str(pathlib.Path.home()), getpass.getuser(),
                  f.stat().st_uid == os.getuid()]))
`;

export default async function (ctx) {
  const { run, write, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  await write('/tmp/users_check.py', SCRIPT);
  const want = {
    root: [0, 0, 0, [0], 'root', '/root', 'root', '/root', 'root', true],
    cone: [1000, 1000, 1000, [100, 1000], 'cone', '/home/cone', 'cone', '/home/cone', 'cone', true],
  };
  for (const user of ['root', 'cone']) {
    const r = await run(['python3', '/tmp/users_check.py'], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    assert.equal(r.status, 0, `${user}: rc=${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout.trim()), want[user], `${user}: ${r.stdout}`);
  }
}
