const SCRIPT = String.raw`
cd /tmp && rm -f FL*
cat > fl-hold.pl <<'PL'
use Fcntl ":flock";
my ($file, $mode) = @ARGV;
open my $f, ">>", $file or die "open: $!";
flock($f, LOCK_EX) or die "flock: $!";
if ($mode eq "fork") { my $p = fork // die "fork: $!"; exit 0 unless $p; waitpid($p, 0) }
close $f if $mode eq "close";
open my $r, ">", "$file.ready" or die; close $r;
for (1 .. 400) { last if -e "$file.stop"; select(undef, undef, undef, 0.05) }
PL
cat > fl-probe.pl <<'PL'
use Fcntl ":flock";
open my $f, ">>", $ARGV[0] or die "open: $!";
print flock($f, LOCK_EX | LOCK_NB) ? "granted" : ($!{EWOULDBLOCK} ? "refused" : "err:$!");
PL
cat > fl-ofd.pl <<'PL'
use Fcntl ":flock";
open my $f, ">", $ARGV[0] or die; open my $g, ">>", $ARGV[0] or die; open my $d, ">&", $f or die;
my $ex = flock($f, LOCK_EX) ? "ex" : "nex:$!";
my $second = flock($g, LOCK_EX | LOCK_NB) ? "granted" : ($!{EWOULDBLOCK} ? "refused" : "err:$!");
my $dup = flock($d, LOCK_EX | LOCK_NB) ? "shares" : "refused:$!";
print "ofd:$ex,$second dup:$dup";
PL
cat > fl-eintr.pl <<'PL'
use Fcntl ":flock";
$SIG{ALRM} = sub {};
open my $f, ">>", $ARGV[0] or die "open: $!";
alarm 1;
my $ok = flock($f, LOCK_EX);
print $ok ? "granted" : ($!{EINTR} ? "EINTR" : "err:$!");
PL
ready() { for i in {1..200}; do [ -e "$1.ready" ] && return 0; sleep 0.05; done; echo "no-ready:$1" >&2; }
ofd=$(perl fl-ofd.pl FLa)
perl fl-hold.pl FLb fork & ready FLb; childexit=$(perl fl-probe.pl FLb); touch FLb.stop; wait
perl fl-hold.pl FLc close & ready FLc; closed=$(perl fl-probe.pl FLc); touch FLc.stop; wait
perl fl-hold.pl FLd hold & pid=$!; ready FLd; held=$(perl fl-probe.pl FLd); kill -9 "$pid"; wait "$pid"; kill9=$(perl fl-probe.pl FLd)
perl fl-hold.pl FLe hold & ready FLe; eintr=$(perl fl-eintr.pl FLe); touch FLe.stop; wait
echo "$ofd | childexit:$childexit | close:$closed | held:$held | kill9:$kill9 | eintr:$eintr"
rm -f FL* fl-*.pl
`;

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['bash', '-c', SCRIPT], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stdout}${r.stderr}`);
  assert.equal(r.stdout.trim(), 'ofd:ex,refused dup:shares | childexit:refused | close:granted | held:refused | kill9:granted | eintr:EINTR',
    `flock lifetimes (per open file description): ${r.stdout}${r.stderr}`);
  console.log(`flock lifetime: ${r.stdout.trim()}`);
}
