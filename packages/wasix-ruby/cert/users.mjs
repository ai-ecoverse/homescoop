/**
 * wasix-ruby 3.4.11-10 (H1, homescoop#207; wasix-sysroot -20): Process.uid,
 * euid, gid, groups, Etc.getpwuid, Etc.getlogin, Dir.home and a file's
 * owner from slicc-kernel, as root and as a kernel.users.add user. -9 (sysroot
 * -17) said uid 1000 "user" for everyone.
 */
const CODE = `require "etc"
pw = Etc.getpwuid(Process.uid)
File.write(File.join(Dir.home, "made"), "x")
puts [Process.uid, Process.euid, Process.gid, Process.groups.sort.join(","), pw.name, pw.dir,
      Etc.getgrgid(Process.gid).name, Dir.home, File.stat(File.join(Dir.home, "made")).uid == Process.uid].join("|")
`;
export default async function (ctx) {
  const { run, write, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  await write('/tmp/users_check.rb', CODE);
  const want = { root: '0|0|0|0|root|/root|root|/root|true', cone: '1000|1000|1000|100,1000|cone|/home/cone|cone|/home/cone|true' };
  for (const user of ['root', 'cone']) {
    const r = await run(['ruby', '/tmp/users_check.rb'], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    assert.equal(r.status, 0, `${user}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout.trim(), want[user], `${user}: ${r.stdout}`);
  }
}
