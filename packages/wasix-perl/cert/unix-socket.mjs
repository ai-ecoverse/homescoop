/**
 * AF_UNIX sockets through IO::Socket::UNIX (homescoop#767). Since
 * wasix-sysroot -31 (#682) bind/listen/connect/accept work, and
 * getsockname/getpeername report a Linux-length sockaddr_un (family, path,
 * NUL). Socket.xs takes such short addresses only on Linux, Cygwin, Solaris
 * and the BSDs, so up to 5.42.0-17 unpack_sockaddr_un, and with it
 * hostpath and peerpath, died with "Bad arg length … should be 112".
 * patches/0008 gives __wasi__ the Linux branch.
 */
const CODE = String.raw`
use strict; use warnings;
use IO::Socket::UNIX;
use Socket qw(SOCK_STREAM unpack_sockaddr_un);
my $try = sub { my $v = eval { $_[0]->() }; return $v if defined $v; my $e = $@ || 'undef'; $e =~ s/ at \S+ line \d+.*//s; "die:$e" };
my $p = '/tmp/perl-unix.sock';
unlink $p;
my $s = IO::Socket::UNIX->new(Type => SOCK_STREAM, Local => $p, Listen => 1) or die "listen: $!";
my @out = (-S $p ? 'socket' : 'not-a-socket');
push @out, 'host=' . $try->(sub { $s->hostpath });
push @out, 'unpack=' . $try->(sub { unpack_sockaddr_un(getsockname $s) });
my $pid = fork // die "fork: $!";
if (!$pid) {
  my $c = IO::Socket::UNIX->new(Type => SOCK_STREAM, Peer => $p) or die "connect: $!";
  my $peer = $try->(sub { $c->peerpath });
  print $c "hello peer=$peer\n";
  close $c;
  exit 0;
}
my $a = $s->accept or die "accept: $!";
my $line = <$a>;
chomp $line if defined $line;
push @out, 'read=' . ($line // 'EOF');
push @out, 'accepted-host=' . $try->(sub { $a->hostpath });
waitpid $pid, 0;
push @out, "child=$?";
unlink $p;
print join('|', @out), "\n";
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('tmp/unix-socket.pl', CODE);
  const r = await run(['perl', '/tmp/unix-socket.pl'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `perl unix-socket.pl: rc=${r.status} ${r.stdout}${r.stderr}`);
  const p = '/tmp/perl-unix.sock';
  assert.equal(
    r.stdout,
    `socket|host=${p}|unpack=${p}|read=hello peer=${p}|accepted-host=${p}|child=0\n`,
    `IO::Socket::UNIX: -S, hostpath, unpack_sockaddr_un(getsockname), the client's peerpath and the accepted socket's hostpath are the path: ${r.stdout}${r.stderr}`,
  );
  console.log(`unix-socket: an IO::Socket::UNIX listener on ${p} accepts a forked client's line; hostpath, peerpath and unpack_sockaddr_un give the path`);
}
