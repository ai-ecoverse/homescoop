const DL = String.raw`
require DynaLoader;
my @defs = map { defined &{"DynaLoader::$_"} ? 1 : 0 } qw(boot_DynaLoader dl_error);
my $err = DynaLoader::dl_error();
package Foo::Missing;
our @ISA = ('DynaLoader');
our $VERSION = '1';
eval { bootstrap Foo::Missing };
my ($croak) = $@ =~ /^(Can't load module Foo::Missing, dynamic loading not available in this perl\.)/;
package Fcntl;
our @ISA = ('DynaLoader');
bootstrap Fcntl;
package main;
print join('|', "defs=@defs", "dl_error=$err", "croak=" . ($croak ? 1 : 0), 'fcntl=' . (defined &Fcntl::F_GETFD ? 1 : 0)), "\n";
`;

const ENC = String.raw`
use Encode qw(encode decode);
my @rows;
for (['UTF-16LE', "\x{e9}\x{20ac}"], ['UTF-16BE', "\x{e9}"], ['UTF-16', "A"], ['UTF-32LE', "\x{1F600}"], ['UCS-2BE', "z"],
     ['cp1252', "\x{20ac}"], ['koi8-r', "\x{416}"], ['MacRoman', "\x{e9}"], ['symbol', "\x{3b1}"], ['cp37', "A"],
     ['euc-cn', "\x{4e2d}"], ['shiftjis', "\x{3042}"], ['euc-kr', "\x{d55c}"], ['big5-eten', "\x{4e2d}"]) {
  my ($name, $s) = @$_;
  my $bytes = eval { encode($name, $s, Encode::FB_CROAK | Encode::LEAVE_SRC) };
  if (!defined $bytes) { (my $e = $@) =~ s/ at .*//s; push @rows, "$name:ERR($e)"; next }
  my $back = decode($name, $bytes);
  push @rows, "$name:" . unpack('H*', $bytes) . ($back eq $s ? '' : ':MISMATCH');
}
print join(' ', @rows), "\n";
`;

const ENC_WANT = [
  'UTF-16LE:e900ac20', 'UTF-16BE:00e9', 'UTF-16:feff0041', 'UTF-32LE:00f60100', 'UCS-2BE:007a',
  'cp1252:80', 'koi8-r:f6', 'MacRoman:8e', 'symbol:61', 'cp37:c1',
  'euc-cn:d6d0', 'shiftjis:82a0', 'euc-kr:c7d1', 'big5-eten:a4a4',
].join(' ');

export default async function (ctx) {
  const { run, assert } = ctx;
  const dl = await run(['perl', '-e', DL], { cwd: '/tmp' });
  assert.equal(dl.status, 0, `DynaLoader: rc=${dl.status} ${dl.stdout}${dl.stderr}`);
  assert.equal(dl.stdout.trim(), 'defs=1 1|dl_error=Not implemented|croak=1|fcntl=1',
    `the real DynaLoader (dl_none.xs): boot_DynaLoader and dl_error exist, dl_error says "Not implemented", a module that is not linked in croaks, Fcntl->bootstrap finds the static boot: ${dl.stdout}${dl.stderr}`);
  const enc = await run(['perl', '-e', ENC], { cwd: '/tmp' });
  assert.equal(enc.status, 0, `Encode: rc=${enc.status} ${enc.stdout}${enc.stderr}`);
  assert.equal(enc.stdout.trim(), ENC_WANT, `Encode's static sub-extensions (Unicode, Byte, Symbol, EBCDIC, CN, JP, KR, TW) encode and decode`);
  const LOAD = 'my %m = (Unicode => "UTF-16LE", Byte => "koi8-r", Symbol => "symbol", EBCDIC => "cp37", CN => "euc-cn", JP => "shiftjis", KR => "euc-kr", TW => "big5-eten"); print join(" ", map { my $e = Encode::find_encoding($m{$_}); ($e ? 1 : 0) . ($INC{"Encode/$_.pm"} ? 1 : 0) } sort keys %m), "\\n"';
  const ucm = await run(['perl', '-MEncode', '-e', LOAD], { cwd: '/tmp' });
  assert.equal(ucm.stdout.trim(), '11 11 11 11 11 11 11 11', `each sub-extension's .pm is installed and loaded on demand (find_encoding, %INC): ${ucm.stdout}${ucm.stderr}`);
  console.log(`static-xs: DynaLoader ${dl.stdout.trim()}; Encode ${enc.stdout.trim()}`);
}
