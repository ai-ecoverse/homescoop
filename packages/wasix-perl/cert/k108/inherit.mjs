const SHOW = 'print join("|", map { defined $SIG{$_} ? $SIG{$_} : "undef" } qw(PIPE USR2 TERM)), "\\n"';
const REAP = '$SIG{CHLD} = "IGNORE"; my $p = fork // die; exit 3 unless $p; select(undef, undef, undef, 0.3); my $w = waitpid($p, 0); print $w == -1 ? "reaped\\n" : "zombie $?\\n"';

export default async function (ctx) {
  const { run, assert } = ctx;
  const ign = await run(['bash', '-c', `trap '' PIPE USR2; exec perl -e '${SHOW}'`], { cwd: '/tmp' });
  assert.equal(ign.status, 0, `rc=${ign.status} ${ign.stdout}${ign.stderr}`);
  assert.equal(ign.stdout, 'IGNORE|IGNORE|undef\n', `under trap '' PIPE USR2, %SIG shows the inherited ignores: ${ign.stdout}${ign.stderr}`);
  const plain = await run(['bash', '-c', `exec perl -e '${SHOW}'`], { cwd: '/tmp' });
  assert.equal(plain.stdout, 'undef|undef|undef\n', `${plain.stdout}${plain.stderr}`);
  const set = await run(['bash', '-c', `trap '' USR2; exec perl -e '$SIG{USR2} = sub { print "handled\\n" }; kill USR2 => $$; select(undef, undef, undef, 0.2)'`], { cwd: '/tmp' });
  assert.equal(set.stdout, 'handled\n', `a handler over an inherited ignore runs: ${set.stdout}${set.stderr}`);
  const reap = await run(['perl', '-e', REAP], { cwd: '/tmp' });
  assert.equal(reap.stdout, 'reaped\n', `$SIG{CHLD} = "IGNORE" reaps the child: ${reap.stdout}${reap.stderr}`);
  console.log("perl %SIG under bash trap '' PIPE USR2 shows IGNORE for both (wasix-sysroot -32's slicc.sigaction_inherited, slicc-kernel >= 1.108.0) and nothing for TERM; without the trap all undef; a handler set over an inherited ignore runs; $SIG{CHLD} = 'IGNORE' reaps a forked child (waitpid -1)");
}
