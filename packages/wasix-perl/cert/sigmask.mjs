const CODE = String.raw`
use POSIX qw(:signal_h);
use Time::HiRes qw(time sleep);
my $hits = 0;
$SIG{USR1} = sub { $hits++ };
my $set = POSIX::SigSet->new(SIGUSR1);
my $old = POSIX::SigSet->new;
POSIX::sigprocmask(SIG_BLOCK, $set, $old) or die "sigprocmask block: $!";
my $was = $old->ismember(SIGUSR1) ? 1 : 0;
kill USR1 => $$;
my $t = time;
select(undef, undef, undef, 0.5);
my $slept = time - $t >= 0.45 ? 1 : 0;
my $pend = POSIX::SigSet->new;
POSIX::sigpending($pend) or die "sigpending: $!";
my $pending = $pend->ismember(SIGUSR1) ? 1 : 0;
my $blocked_hits = $hits;
my $before = POSIX::SigSet->new;
POSIX::sigprocmask(SIG_UNBLOCK, $set, $before) or die "sigprocmask unblock: $!";
my $n = 0; $n++ while $hits == 0 && $n < 1000000;
my $after = POSIX::SigSet->new;
POSIX::sigpending($after);
print join(" ", "was=$was", "slept=$slept", "pending=$pending", "blocked_hits=$blocked_hits",
  "masked=" . ($before->ismember(SIGUSR1) ? 1 : 0), "hits=$hits", "left=" . ($after->ismember(SIGUSR1) ? 1 : 0)), "\n";
`;

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['perl', '-e', CODE], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  assert.equal(r.stdout.trim(), 'was=0 slept=1 pending=1 blocked_hits=0 masked=1 hits=1 left=0', `sigprocmask: ${r.stdout}${r.stderr}`);
  console.log(`sigmask: ${r.stdout.trim()}`);
}
