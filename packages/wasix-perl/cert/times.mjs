export default async function (ctx) {
  const { run, assert } = ctx;
  const perl = async (code) => {
    const r = await run(['perl', '-e', code], { cwd: '/tmp' });
    assert.equal(r.status, 0, `${code}: rc=${r.status} ${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  };
  const touched = await perl('open my $f, ">", "/tmp/pt" or die; close $f; utime 1000000000, 1100000000, "/tmp/pt" or die "explicit: $!"; my $e = (stat "/tmp/pt")[9]; utime undef, undef, "/tmp/pt" or die "undef: $!"; my $n = (stat "/tmp/pt")[9]; print "$e ", (abs($n - time) <= 5 ? "now" : "mtime=$n"), "\\n"');
  assert.equal(touched, '1100000000 now', 'utime explicit, then utime undef, undef sets the times to now');
  const cpu = await perl('my $u0 = (times)[0]; my $w = time; 1 while (times)[0] - $u0 < 0.5 && time - $w < 20; my @t = times; my $d = $t[0] - $u0; printf "%s sys=%s cuser=%s csys=%s\\n", ($d >= 0.5 && $d < 5 ? "reached" : sprintf("delta=%.2f", $d)), $t[1], $t[2], $t[3]');
  assert.equal(cpu, 'reached sys=0 cuser=0 csys=0', `times: ${cpu}`);
  console.log(`times: ${touched}; ${cpu}`);
}
