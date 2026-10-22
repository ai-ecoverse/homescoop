/**
 * wasix-perl 5.42.0-9 (H1, homescoop#207; wasix-sysroot -20): $<, $>, $(,
 * getpwuid and getgrgid from slicc-kernel's process credentials and its
 * /etc/passwd, as root and as a kernel.users.add user. -8 (sysroot -17)
 * said uid 1000 "user" for everyone; getgroups was a stub, so $( listed
 * only the gid.
 */
const CODE = String.raw`my @p = getpwuid($<); my @g = getgrgid($( + 0); print join("|", $<, $>, join(",", sort { $a <=> $b } split " ", $(), $p[0], $p[7], $g[0]), "\n"`;
export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const want = { root: '0|0|0,0|root|/root|root', cone: '1000|1000|100,1000,1000|cone|/home/cone|cone' };
  for (const user of ['root', 'cone']) {
    const r = await run(['perl', '-e', CODE], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    assert.equal(r.status, 0, `${user}: ${r.stdout}${r.stderr}`);
    assert.equal(r.stdout.trim(), want[user], `${user}: ${r.stdout}`);
  }
  const w = await run(['perl', '-e', String.raw`if (open my $f, ">", "/root/cone-was-here") { print "granted\n" } else { print "denied: $!\n" } print -w "/root" ? "w\n" : "nw\n"`], { cwd: '/tmp', user: 'cone' });
  assert.equal(w.status, 0, `cone: ${w.stdout}${w.stderr}`);
  assert.equal(w.stdout.trim(), 'denied: Permission denied\nnw', `cone writing into /root: ${w.stdout}`);
  const own = await run(['perl', '-e', String.raw`open my $f, ">", "/home/cone/mine" or die "open: $!"; print $f "x"; close $f; my @s = stat "/home/cone/mine"; print "$s[4]\n"`], { cwd: '/tmp', user: 'cone' });
  assert.equal(own.stdout.trim(), '1000', `cone writing into its home: ${own.stdout}${own.stderr}`);
}
