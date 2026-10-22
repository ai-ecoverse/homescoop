const MODULES = 'use POSIX (); use Encode (); use Data::Dumper (); use File::Find (); use File::Temp (); use File::Spec (); use Getopt::Long (); use Pod::Simple::Text (); use Test::More (); use IO::Socket::UNIX (); use Digest::SHA (); use List::Util (); use Text::Balanced (); use Cwd (); print scalar(keys %INC), "\\n";\n';
const TEXT = 'my $s = join("", map { "line $_ of the configure script: AC_CHECK_FUNCS([f$_ g$_ h$_])\\n" } 1 .. 60000); (my $t = $s) =~ s/AC_CHECK_FUNCS\\(\\[(.*?)\\]\\)/ac_cv_func_$1=yes/g; my %w; $w{$_}++ for split /\\W+/, $t; my @k = sort keys %w; print length($s), " ", scalar(@k), "\\n";\n';
const HASH = 'my %h; $h{"key$_"} = [$_, "v" x 20] for 1 .. 100000; my $n = 0; $n += $h{$_}[0] for sort keys %h; print "$n\\n";\n';
const AUTOMAKE = 'my @lines = map { $_ % 3 ? "prog${_}_SOURCES = a$_.c b$_.c c$_.h" : "bin_PROGRAMS += prog$_" } 1 .. 30000; my (%src, @progs); for (@lines) { if (/^(\\w+)_SOURCES\\s*=\\s*(.*)$/) { $src{$1} = [split " ", $2] } elsif (/^bin_PROGRAMS\\s*\\+=\\s*(\\S+)/) { push @progs, $1 } } my $out = join "", map { "$_: " . join(" ", map { s/\\.c$/.o/r } @{ $src{$_} }) . "\\n" } sort keys %src; print scalar(@progs), " ", length($out), "\\n";\n';
const FORK = 'my $pid = fork(); if (!$pid) { my $s = "x" x (2 * 1024 * 1024); $s =~ s/x/yy/g; exit(length($s) == 4 * 1024 * 1024 ? 0 : 1) } waitpid($pid, 0); print $? >> 8, "\\n";\n';
const WORK = { modules: MODULES, text: TEXT, hash: HASH, automake: AUTOMAKE, fork: FORK };
const WANT = { modules: /^\d{2,}$/, text: /^4\d{6} \d+$/, hash: /^5000050000$/, automake: /^10000 \d+$/, fork: /^0$/ };
const INITIAL_KB = 64 * 1024;
const GROWS = new Set(['text']);

export default async function (ctx) {
  const { run, write, assert } = ctx;
  for (const [name, text] of Object.entries(WORK)) await write(`/tmp/perl-heap/${name}.pl`, text);
  const script = (name) =>
    [
      `perl /tmp/perl-heap/${name}.pl >/tmp/perl-heap/${name}.out 2>/tmp/perl-heap/${name}.err & pid=$!; m=0`,
      'while kill -0 $pid 2>/dev/null; do',
      '  if [ -r /proc/$pid/status ]; then n=; v=0; while read -r k x u; do [ "$k" = Name: ] && n=$x; [ "$k" = VmSize: ] && v=$x; done < /proc/$pid/status 2>/dev/null; [ "$n" = perl ] && [ "$v" -gt "$m" ] && m=$v; fi',
      'done; wait $pid; rc=$?',
      `t=0; while IFS= read -r l; do case $l in *"wasm trap"*|*"out of bounds"*) t=$((t+1));; esac; done < /tmp/perl-heap/${name}.err`,
      'echo "rc=$rc peak_kb=$m traps=$t"',
    ].join('\n');
  let traps = 0;
  const peaks = {};
  for (let round = 1; round <= 3; round++) {
    for (const name of Object.keys(WORK)) {
      const r = await run(['bash', '-c', script(name)], { cwd: '/tmp', env: { SLICC_WASM_BACKTRACE: '1' } });
      const m = /rc=(\d+) peak_kb=(\d+) traps=(\d+)/.exec(r.stdout) ?? [];
      traps += Number(m[3] ?? 1);
      peaks[name] = Math.max(peaks[name] ?? 0, Number(m[2] ?? 0));
      const out = await run(['cat', `/tmp/perl-heap/${name}.out`, `/tmp/perl-heap/${name}.err`]);
      assert.equal(Number(m[1]), 0, `round ${round} ${name}: ${r.stdout} ${out.stdout}`);
      assert.match(out.stdout.trim(), WANT[name], `round ${round} ${name}`);
    }
  }
  console.log(`heap: 3 rounds of ${Object.keys(WORK).join(', ')}: ${traps} traps, VmSize peak kB ${JSON.stringify(peaks)}`);
  assert.equal(traps, 0, 'no wasm trap in 3 rounds');
  for (const [name, kb] of Object.entries(peaks)) {
    assert.ok(kb > 0, `${name}: no VmSize read from /proc/<pid>/status`);
    if (GROWS.has(name)) assert.ok(kb > INITIAL_KB, `${name}: the 4.5 MiB text workload grows past the 64 MiB initial heap through memory.grow and the allocator refresh: VmSize peak ${kb} kB`);
    else assert.equal(kb, INITIAL_KB, `${name}: the wasm memory stays at the 64 MiB initial heap, so perl never calls memory.grow (recipe.yaml wasm, wasix-sysroot -42's dlmalloc uses the initial pages; homescoop#1287): VmSize peak ${kb} kB`);
  }
}
