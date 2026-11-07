import { checkCases, linkZoneinfo } from './lib/zones.mjs';

// Perl's localtime and POSIX::strftime are libc's (musl's __tz.c).
const SCRIPT = String.raw`
use strict; use warnings; use POSIX qw(strftime);
for my $arg (@ARGV) {
  my ($k, $t) = split /=/, $arg;
  my @lt = localtime($t);
  print "$k ", strftime("%H:%M %Z %z", @lt), "\n";
}
`;

export default async function (ctx) {
  await linkZoneinfo(ctx);
  await ctx.write('/tmp/tz_local.pl', SCRIPT);
  await checkCases(ctx, 'perl', ['perl', '/tmp/tz_local.pl']);
}
