/**
 * flock (homescoop#631): perl's flock excludes other processes. Until
 * 5.42.0-14 wasix-posix-stubs.h answered every flock with success, so two
 * autom4te runs on one autom4te.cache raced (cannot rename …0t). 5.42.0-15
 * maps flock onto whole-file fcntl record locks (F_SETLK / F_SETLKW), which
 * slicc-kernel enforces from 1.100.0 (slicc.fcntl_lock, slicc-kernel#722),
 * as perl's own flock emulation does without flock(2): fcntl semantics, so
 * a lock belongs to the process (not inherited by fork, released when the
 * process closes any handle on the file). LOCK_EX on a read-only handle is
 * a read lock (it keeps writers out), LOCK_SH on a write-only one a write
 * lock, since fcntl wants the handle's mode to match.
 */
const CODE = String.raw`
use Fcntl qw(:flock);
use IO::Handle;
use Time::HiRes qw(time sleep);
my $f = '/tmp/perl-flock';
my $try = sub { my ($fh, $op) = @_; flock($fh, $op) ? 'ok' : ($!{EWOULDBLOCK} ? 'EWOULDBLOCK' : "err:$!") };
open(my $fh, '+>>', $f) or die "open: $!";
my @parent = ($try->($fh, LOCK_EX));
pipe(my $r, my $w) or die;
my $pid = fork // die "fork: $!";
if (!$pid) {
  close $r;
  open(my $c, '+>>', $f) or die "child open: $!";
  my @out = ($try->($c, LOCK_EX | LOCK_NB), $try->($c, LOCK_SH | LOCK_NB));
  $w->autoflush(1);
  print $w "@out\n";
  my $t = time;
  my $wait = $try->($c, LOCK_EX);
  printf $w "%s %.1f\n", $wait, time - $t;
  push @out, $try->($c, LOCK_UN);
  close $w;
  exit 0;
}
close $w;
my $child = <$r>; chomp $child;
sleep 1.0;
push @parent, $try->($fh, LOCK_UN);
my $waited = <$r>; chomp $waited;
waitpid($pid, 0);
my ($wres, $secs) = split ' ', $waited;
# Shared locks: two readers at once, a writer refused.
open(my $s1, '<', $f) or die;
push @parent, $try->($s1, LOCK_SH);
my $pid2 = fork // die;
if (!$pid2) {
  open(my $s2, '+<', $f) or die;
  my $sh = $try->($s2, LOCK_SH | LOCK_NB);
  my $ex = $try->($s2, LOCK_EX | LOCK_NB);
  exit(($sh eq 'ok' ? 0 : 1) + ($ex eq 'EWOULDBLOCK' ? 0 : 2));
}
waitpid($pid2, 0);
my $shared = $? >> 8;
close $s1;
# LOCK_EX on a read-only handle (a lock file opened '<') succeeds and keeps
# a writer's LOCK_EX out (it is a read lock under fcntl).
open(my $ro, '<', $f) or die;
my $rox = $try->($ro, LOCK_EX);
my $pid3 = fork // die;
if (!$pid3) {
  open(my $wr, '+>>', $f) or die;
  exit($try->($wr, LOCK_EX | LOCK_NB) eq 'EWOULDBLOCK' ? 0 : 1);
}
waitpid($pid3, 0);
my $readonly = "$rox:" . ($? >> 8);
print join(' | ', "parent=@parent", "child=$child", "blocking=$wres:" . ($secs >= 0.8 ? 'waited' : 'at-once'), "shared=$shared", "readonly=$readonly"), "\n";
`;

export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  const want = 'parent=ok ok ok | child=EWOULDBLOCK EWOULDBLOCK | blocking=ok:waited | shared=0 | readonly=ok:0';
  for (const user of [undefined, 'cone']) {
    if (user) await addUser({ name: user });
    const cwd = user ? `/home/${user}` : '/tmp';
    const r = await run(['perl', '-e', CODE.replaceAll('/tmp/perl-flock', `${cwd}/perl-flock`)], { cwd, ...(user && { user }) });
    assert.equal(r.status, 0, `${user ?? 'root'}: rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
    assert.equal(r.stdout.trim(), want, `${user ?? 'root'}: flock between processes: ${r.stdout}${r.stderr}`);
  }
  // Two separate perl processes, as two autom4te runs (#631's repro).
  const two = await run(['bash', '-c', [
    'cd /tmp && : > L2',
    "perl -e 'use Fcntl qw(:flock); open my $f, \">>\", \"L2\" or die; flock($f, LOCK_EX) or die; print STDERR \"held\\n\"; sleep 3' &",
    'sleep 1',
    "perl -e 'use Fcntl qw(:flock); open my $f, \">>\", \"L2\" or die; print flock($f, LOCK_EX|LOCK_NB) ? \"granted\\n\" : \"refused: $!\\n\"'",
    'wait',
  ].join('\n')], { cwd: '/tmp' });
  assert.equal(two.status, 0, `two processes: ${two.stdout}${two.stderr}`);
  assert.match(two.stdout, /^refused: Resource temporarily unavailable\n$/, `a second process's LOCK_EX|LOCK_NB while the first holds LOCK_EX: ${two.stdout}${two.stderr}`);
  console.log(`flock: ${want}, as root and cone; a second perl process is refused while the first holds LOCK_EX`);
}
