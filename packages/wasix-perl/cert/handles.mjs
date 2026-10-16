export default async function (ctx) {
  const { run, assert } = ctx;
  const perl = async (code) => {
    const r = await run(['perl', '-e', code], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${code}: rc=${r.status} ${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  };
  const times = await perl('open my $f, ">", "/tmp/ph" or die; utime 1000000000, 1100000000, $f or die "explicit: $!"; my $e = (stat "/tmp/ph")[9]; utime undef, undef, $f or die "undef: $!"; my $n = (stat "/tmp/ph")[9]; close $f; print "$e ", (abs($n - time) <= 5 ? "now" : "mtime=$n"), "\\n"');
  assert.equal(times, '1100000000 now', 'utime on a filehandle (futimes): explicit times, then undef, undef is now');
  const locks = await perl('use Fcntl ":flock"; open my $f, ">", "/tmp/pl" or die; my @r = (flock($f, LOCK_EX) ? 1 : 0, flock($f, LOCK_SH | LOCK_NB) ? 1 : 0, flock($f, LOCK_UN) ? 1 : 0); close $f; push @r, flock($f, LOCK_EX) ? 1 : "0:" . ($!{EBADF} ? "EBADF" : $!); print "@r\\n"');
  assert.equal(locks, '1 1 1 0:EBADF', 'flock on a write-only handle takes LOCK_EX, LOCK_SH (as a write lock, 5.42.0-15) and LOCK_UN, and fails with EBADF on a closed one');
  const access = await perl('use filetest "access"; open my $f, ">", "/tmp/pa" or die; close $f; chmod 0644, "/tmp/pa"; mkdir "/tmp/pd"; print join(" ", map { $_ ? 1 : 0 } -r "/tmp/pa", -w "/tmp/pa", -e "/tmp/pa", -x "/tmp/pd", -r "/tmp/missing"), "\\n"');
  assert.equal(access, '1 1 1 1 0', `use filetest "access" asks eaccess: ${access}`);
  console.log(`handles: utime on a handle ${times}; flock ${locks}; filetest access ${access}`);
}
