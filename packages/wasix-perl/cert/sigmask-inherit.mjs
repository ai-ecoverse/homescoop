const CODE = String.raw`
use POSIX qw(:signal_h);
sub mask { my $s = POSIX::SigSet->new; POSIX::sigprocmask(SIG_BLOCK, POSIX::SigSet->new, $s) or die "query: $!"; join(",", grep { $s->ismember($_) } 1..31) || "none" }
POSIX::sigprocmask(SIG_SETMASK, POSIX::SigSet->new(SIGUSR1, SIGTERM)) or die "setmask: $!";
pipe(my $r, my $w) or die;
my $pid = fork // die "fork: $!";
if (!$pid) { close $r; print $w mask(), "\n"; close $w; exit 0 }
close $w; my $forkchild = <$r>; chomp $forkchild; waitpid($pid, 0);
my $mcode = 'use POSIX qw(:signal_h); my $s = POSIX::SigSet->new; POSIX::sigprocmask(SIG_BLOCK, POSIX::SigSet->new, $s); print join(",", grep { $s->ismember($_) } 1..31) || "none"';
$pid = open(my $e, "-|") // die "fork: $!";
if (!$pid) { exec $^X, "-e", $mcode or die "exec: $!" }
my $execchild = <$e>; close $e;
system($^X, "-e", "open(STDOUT, '>', '/tmp/sigi-system') or die; $mcode") == 0 or die "system: $?";
open(my $sf, "<", "/tmp/sigi-system") or die; my $systemchild = <$sf>; close $sf;
system("true"); my $q = qx(echo hi); chomp $q;
my $kept = mask();
POSIX::sigprocmask(SIG_SETMASK, POSIX::SigSet->new) or die "clear: $!";
system("true"); qx(echo hi);
my $after = mask();
my ($hits, $inside) = (0, -1);
$SIG{USR1} = sub { $hits++; if ($hits == 1) { kill USR1 => $$; my $n = 0; $n++ while $n < 200000; $inside = $hits } };
kill USR1 => $$;
my $n = 0; $n++ while $hits < 2 && $n < 2000000;
print "forkchild=$forkchild execchild=$execchild systemchild=$systemchild kept=$kept after=$after qx=$q nested_in_handler=$inside total=$hits\n";
`;

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['perl', '-e', CODE], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  assert.equal(r.stdout.trim(), 'forkchild=10,15 execchild=10,15 systemchild=10,15 kept=10,15 after=none qx=hi nested_in_handler=1 total=2',
    `a blocked mask reaches fork, exec and system children, system and qx keep it, and a handler's own signal waits until the handler returns: ${r.stdout}${r.stderr}`);
  console.log(`sigmask-inherit: ${r.stdout.trim()}`);
}
