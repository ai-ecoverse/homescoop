const CODE = String.raw`
use Fcntl qw(F_GETLK F_SETLK F_SETLKW F_RDLCK F_WRLCK F_UNLCK SEEK_SET);
use IO::Handle;
use Time::HiRes qw(time sleep);
my $L = sub { pack('s s x4 q q l x4', $_[0], SEEK_SET, $_[1], $_[2], 0) };
my $U = sub { my ($t, $w, $s, $l, $p) = unpack('s s x4 q q l x4', $_[0]); "$t:$s+$l" . ($_[1] && $t != F_UNLCK ? ($p == $_[1] ? ':parent' : ":pid$p") : '') };
my $try = sub { my ($fh, $cmd, @a) = @_; fcntl($fh, $cmd, $L->(@a)) ? 'ok' : ($!{EAGAIN} ? 'EAGAIN' : $!{EACCES} ? 'EACCES' : $!{EINVAL} ? 'EINVAL' : $!{EBADF} ? 'EBADF' : "err:$!") };
my $consts = join(',', F_GETLK, F_SETLK, F_SETLKW, F_RDLCK, F_WRLCK, F_UNLCK);
open(my $fh, '+>', '/tmp/perl-locks') or die "open: $!";
print $fh 'x' x 40; $fh->flush;
my $wr = $try->($fh, F_SETLK, F_WRLCK, 0, 5);
my $rd = $try->($fh, F_SETLKW, F_RDLCK, 20, 5);
my $bad = $try->($fh, F_SETLK, 7, 0, 5);
my $q = $L->(F_WRLCK, 0, 5);
fcntl($fh, F_GETLK, $q) or die "getlk: $!";
my $own = $U->($q);
pipe(my $r, my $w) or die;
pipe(my $gor, my $gow) or die;
my $parent = $$;
my $pid = fork // die "fork: $!";
if (!$pid) {
  close $r; close $gow;
  open(my $c, '+<', '/tmp/perl-locks') or die "child open: $!";
  my @out = ($try->($c, F_SETLK, F_WRLCK, 0, 5), $try->($c, F_SETLK, F_WRLCK, 5, 5), $try->($c, F_SETLK, F_RDLCK, 20, 5), $try->($c, F_SETLK, F_WRLCK, 20, 5));
  my $g = $L->(F_WRLCK, 0, 5);
  push @out, fcntl($c, F_GETLK, $g) ? $U->($g, $parent) : "err:$!";
  $w->autoflush(1);
  print $w "@out\n";
  my $t = time;
  my $wait = $try->($c, F_SETLKW, F_WRLCK, 0, 5);
  printf $w "%s %.1f\n", $wait, time - $t;
  close $w;
  exit 0;
}
close $w;
my $child = <$r>; chomp $child;
sleep 1.0;
my $un = $try->($fh, F_SETLK, F_UNLCK, 0, 5);
my $waited = <$r>; chomp $waited;
waitpid($pid, 0);
my ($wres, $secs) = split ' ', $waited;
print join(' | ', "consts=$consts", "parent=$wr,$rd,$bad own=$own", "child=$child", "unlock=$un", "setlkw=$wres:" . ($secs >= 0.8 ? 'waited' : 'at-once')), "\n";
`;

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['perl', '-e', CODE], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  const kv = ctx.kernel?.version ?? '';
  const [maj, min] = kv.split('.').map(Number);
  const floor = ctx.installed?.[0]?.engines?.['slicc-kernel'];
  const m = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(floor ?? '');
  assert.ok(m && (Number(m[1]) > 1 || Number(m[2]) >= 100), `engines.slicc-kernel is at least >=1.100.0, the first kernel with slicc.fcntl_lock: on older kernels every lock is granted locally (homescoop#552): ${floor}`);
  assert.ok(maj > 1 || (maj === 1 && min >= 100), `the cert kernel ${kv || '(unknown)'} satisfies engines ${floor}`);
  assert.equal(r.stdout.trim(), 'consts=12,13,14,0,1,2 | parent=ok,ok,EINVAL own=2:0+5 | child=EAGAIN ok ok EAGAIN 1:0+5:parent | unlock=ok | setlkw=ok:waited',
    `fcntl F_SETLK/F_SETLKW/F_GETLK on slicc-kernel ${kv}: real locks between processes through slicc.fcntl_lock: ${r.stdout}${r.stderr}`);
  console.log(`locks (slicc-kernel ${kv}): ${r.stdout.trim()}`);
}
