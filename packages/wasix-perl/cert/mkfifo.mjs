/**
 * POSIX::mkfifo (5.42.0-19, homescoop#878): libc's mkfifo through
 * slicc_fs.path_mkfifo (wasix-sysroot -34, slicc-kernel 1.120.0). Up to
 * 5.42.0-18 wasix-posix-stubs.h answered mkfifo and mknod with EOPNOTSUPP.
 * A FIFO is made with the umask applied, -p sees it, an existing name is
 * EEXIST, and a forked writer and the reader meet through it.
 */
const CODE = String.raw`
use POSIX qw(mkfifo);
umask 022;
my $f = '/tmp/perl-fifo';
unlink $f;
my @o = (mkfifo($f, 0666) ? 'ok' : "fail:$!");
push @o, (-p $f ? 'fifo' : 'not-fifo'), sprintf('%04o', (stat $f)[2] & 07777);
push @o, mkfifo($f, 0600) ? 'again-ok' : ($!{EEXIST} ? 'EEXIST' : "again:$!");
my $pid = fork // die "fork: $!";
if (!$pid) { open(my $w, '>', $f) or die "w: $!"; print $w "through the fifo\n"; close $w; exit 0 }
open(my $r, '<', $f) or die "r: $!";
my $line = <$r>; chomp $line;
waitpid($pid, 0);
push @o, "read=$line", "child=" . ($? >> 8);
unlink $f;
print join(' | ', @o), "\n";
`;

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['perl', '-e', CODE], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stdout}${r.stderr}`);
  assert.equal(r.stdout, 'ok | fifo | 0644 | EEXIST | read=through the fifo | child=0\n', `POSIX::mkfifo: ${r.stdout}${r.stderr}`);
  console.log(`mkfifo: ${r.stdout.trim()}`);
}
