export default async function (ctx) {
  const { run, assert } = ctx;
  const where = await run(['perl', '-e', 'my $f = $INC{"strict.pm"} // do { require strict; $INC{"strict.pm"} }; $f =~ s{/lib/perl5/strict\.pm$}{} or die "strict.pm at $f\n"; print $f'], { cwd: '/tmp' });
  assert.equal(where.status, 0, `rc=${where.status} ${where.stdout}${where.stderr}`);
  const root = where.stdout.trim();
  const r = await run(['bash', '-c', `stat -c %a ${root}/bin/perl.wasm`], { cwd: '/tmp' });
  assert.equal(r.status, 0, `stat: ${r.stdout}${r.stderr}`);
  assert.equal(r.stdout.trim(), '755', `${root}/bin/perl.wasm mode`);
  console.log(`wasm-mode: ${root}/bin/perl.wasm 755`);
}
