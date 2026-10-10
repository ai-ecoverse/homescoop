/**
 * wasix-perl 5.42.0-9 (wasix-sysroot -20: the libc reports every %SIG change
 * to slicc-kernel through slicc.sigaction_set, and -19's alarm/raise): Perl
 * signal handlers fire on slicc-kernel 1.47.1. 5.42.0-8 (sysroot -17, no
 * hook) never ran $SIG{CHLD} or $SIG{WINCH} there: daemons that reap in
 * $SIG{CHLD} left zombies (thr_bthjyuf4fr's 1.47.1 cert).
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const perl = async (code) => {
    const r = await run(['perl', '-e', code], { cwd: '/tmp' });
    assert.equal(r.status, 0, `perl -e ${code}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    return r.stdout;
  };
  // $SIG{CHLD} reaps three children: no zombies left.
  assert.equal(await perl(String.raw`
    use POSIX ":sys_wait_h"; my $n = 0;
    $SIG{CHLD} = sub { while ((my $p = waitpid(-1, WNOHANG)) > 0) { $n++ } };
    for (1..3) { my $p = fork; if (!$p) { exit 0 } }
    my $t = time; select(undef, undef, undef, 0.05) while $n < 3 && time - $t < 5;
    print "reaped $n left ", (waitpid(-1, WNOHANG) > 0 ? "zombie" : "none"), "\n";
  `), 'reaped 3 left none\n');
  // WINCH, USR1, INT and ALRM handlers run; IGNORE survives TERM.
  assert.equal(await perl(String.raw`
    my %h; $SIG{$_} = do { my $s = $_; sub { $h{$s}++ } } for qw(WINCH USR1 INT ALRM);
    $SIG{TERM} = "IGNORE";
    kill $_, $$ for qw(WINCH USR1 INT TERM);
    alarm 1;
    my $t = time; select(undef, undef, undef, 0.05) while (keys %h) < 4 && time - $t < 5;
    print join(" ", map { "$_=" . ($h{$_} // 0) } qw(WINCH USR1 INT ALRM)), " alive\n";
  `), 'WINCH=1 USR1=1 INT=1 ALRM=1 alive\n');
  // A handler set back to DEFAULT: TERM ends the process (143 from bash).
  const d = await run(['bash', '-c', `perl -e '$SIG{TERM} = sub {}; $SIG{TERM} = "DEFAULT"; kill "TERM", $$; sleep 2; print "survived\\n"'; echo "rc=$?"`], { cwd: '/tmp' });
  assert.equal(d.stdout.trim(), 'rc=143', d.stdout + d.stderr);
}
