export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['perl', '-MConfig', '-e', String.raw`my @bad = grep { defined $Config{$_} && $Config{$_} =~ m{/home/runner|/Users/|/work/|homescoop-rebuild|/packages/wasix-perl/} } sort keys %Config; print join(",", @bad), "\n", $Config{ccflags}, "\n", ($Config{config_args} =~ /-include (\S+)/)[0] // "none", "\n"`], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stdout}${r.stderr}`);
  const [bad, ccflags, include] = r.stdout.split('\n');
  assert.equal(bad, '', `%Config values naming a build path: ${bad}`);
  assert.match(ccflags, / -include packages\/wasix-perl\/wasix-posix-stubs\.h$/, `ccflags: ${ccflags}`);
  assert.equal(include, 'packages/wasix-perl/wasix-posix-stubs.h', `config_args' -include: ${include}`);
  console.log(`config paths: no build path in %Config; ccflags and config_args include ${include}`);
}
