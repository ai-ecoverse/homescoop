/**
 * wasix-perl file modes (homescoop#169): built on wasix-sysroot 2025.9.30-17,
 * whose libc sets and reads modes through slicc-kernel's slicc_fs imports
 * (1.35.1). umask, chmod, mkdir modes and File::Temp's 600/700 hold, and
 * perl's own stat sees the same bits as coreutils.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const cwd = '/home/perl-modes';
  assert.equal((await run(['mkdir', '-p', cwd], { cwd: '/home' })).status, 0);
  const r = await run(['perl', '-MFile::Temp=tempfile,tempdir', '-e', `
    my $old = umask 027;
    open my $f, '>', 'grp' or die "grp: $!"; close $f;
    umask 022;
    my ($fh, $tf) = tempfile('tfXXXXXX', DIR => '.'); close $fh;
    my $td = tempdir('tdXXXXXX', DIR => '.');
    mkdir 'priv', 0700 or die "priv: $!";
    open $f, '>', 'exe' or die "exe: $!"; close $f;
    chmod 0755, 'exe' or die "chmod: $!";
    printf "old %03o\\n", $old;
    print "tf $tf\\ntd $td\\n";
    printf "in %s %o\\n", $_, (stat $_)[2] & 07777 for 'grp', $tf, $td, 'priv', 'exe';
    print -x 'exe' ? "exe is executable\\n" : "exe is not executable\\n";
  `], { cwd });
  assert.equal(r.status, 0, `perl rc=${r.status} stderr=${r.stderr}`);
  const tf = r.stdout.match(/^tf (?:\.\/)?(\S+)$/m)?.[1];
  const td = r.stdout.match(/^td (?:\.\/)?(\S+)$/m)?.[1];
  assert.ok(tf && td, `temp names: ${r.stdout}`);
  assert.match(r.stdout, /^old 022$/m);
  const want = { grp: '640', [tf]: '600', [td]: '700', priv: '700', exe: '755' };
  const st = await run(['stat', '-c', '%a %n', ...Object.keys(want)], { cwd });
  assert.equal(st.status, 0, st.stderr);
  const got = Object.fromEntries(st.stdout.trim().split('\n').map((l) => l.split(' ').reverse()));
  assert.deepEqual(got, want);
  // perl's own stat (slicc_fs path_mode) agrees.
  for (const [f, m] of Object.entries(want)) assert.match(r.stdout, new RegExp(`^in (\\./)?${f} ${m}$`, 'm'), `perl stat ${f}`);
  assert.match(r.stdout, /^exe is executable$/m);
}
