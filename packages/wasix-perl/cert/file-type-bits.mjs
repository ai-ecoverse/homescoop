const CODE = String.raw`
use strict; use warnings;
use POSIX qw(mkfifo);
use Fcntl qw(:mode);
use IO::Socket::UNIX;
use Socket qw(SOCK_STREAM);
my ($f, $s) = ('/tmp/perl-ftype-fifo', '/tmp/perl-ftype.sock');
unlink $f, $s;
mkfifo($f, 0600) or die "mkfifo: $!";
my $l = IO::Socket::UNIX->new(Type => SOCK_STREAM, Local => $s, Listen => 1) or die "listen: $!";
my @o;
for my $p ([fifo => $f], [sock => $s]) {
  my ($name, $path) = @$p;
  my $m = (stat $path)[2];
  my $lm = (lstat $path)[2];
  push @o, sprintf('%s mode=%o type=%o lstat=%o isfifo=%d issock=%d p=%d S=%d', $name, $m, $m & 0170000, $lm & 0170000,
    S_ISFIFO($m) ? 1 : 0, S_ISSOCK($m) ? 1 : 0, (-p $path) ? 1 : 0, (-S $path) ? 1 : 0);
}
push @o, sprintf('IFIFO=%o IFSOCK=%o IFMT=%o', S_IFIFO, S_IFSOCK, S_IFMT);
close $l;
print join("\n", @o), "\n";
`;

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['bash', '-c', `perl -e '${CODE.replace(/'/g, "'\\''")}' && stat -c '%n %f' /tmp/perl-ftype-fifo /tmp/perl-ftype.sock; rm -f /tmp/perl-ftype-fifo /tmp/perl-ftype.sock`], { cwd: '/tmp' });
  const out = `rc=${r.status}\n${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  assert.match(r.stdout, /^fifo mode=10600 type=10000 lstat=10000 isfifo=1 issock=0 p=1 S=0$/m, `a FIFO's (stat)[2] has Linux's 0010000 (5.42.0-19: 0140600):\n${out}`);
  assert.match(r.stdout, /^sock mode=14\d{4} type=140000 lstat=140000 isfifo=0 issock=1 p=0 S=1$/m, `a socket's (stat)[2] has Linux's 0140000 (5.42.0-19: 0160000):\n${out}`);
  assert.match(r.stdout, /^IFIFO=10000 IFSOCK=140000 IFMT=170000$/m, `Fcntl's S_IFIFO / S_IFSOCK are Linux's:\n${out}`);
  const fifoHex = /^\/tmp\/perl-ftype-fifo ([0-9a-f]+)$/m.exec(r.stdout)?.[1];
  const sockHex = /^\/tmp\/perl-ftype\.sock ([0-9a-f]+)$/m.exec(r.stdout)?.[1];
  const fifoMode = /^fifo mode=(\d+)/m.exec(r.stdout)?.[1];
  const sockMode = /^sock mode=(\d+)/m.exec(r.stdout)?.[1];
  assert.equal(parseInt(fifoMode, 8) & 0o170000, parseInt(fifoHex, 16) & 0o170000, `perl's FIFO type bits match coreutils stat -c %f:\n${out}`);
  assert.equal(parseInt(sockMode, 8) & 0o170000, parseInt(sockHex, 16) & 0o170000, `perl's socket type bits match coreutils stat -c %f:\n${out}`);
  console.log(`file-type bits: ${r.stdout.trim().replace(/\n/g, ' | ')}`);
}
