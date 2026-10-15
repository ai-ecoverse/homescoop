export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/pv/t/a.t', 'use strict; use warnings; print "1..2\\nok 1 - one\\n"; print STDERR "# a diagnostic\\n"; print "ok 2 - two\\n";\n');
  await write('/tmp/pv/t/b.t', 'use Test::More tests => 3; ok(1, "first"); is(1 + 1, 2, "sum"); like("abc", qr/b/, "match");\n');
  const p = await run(['prove', 't/'], { cwd: '/tmp/pv' });
  assert.equal(p.status, 0, `prove t/: rc=${p.status} ${p.stdout}${p.stderr}`);
  assert.match(p.stdout, /^Files=2, Tests=5,/m, p.stdout);
  assert.match(p.stdout, /^Result: PASS$/m, p.stdout);
  const v = await run(['prove', '-v', 't/a.t'], { cwd: '/tmp/pv' });
  assert.equal(v.status, 0, `prove -v: ${v.stdout}${v.stderr}`);
  assert.match(v.stdout, /^ok 2 - two$/m, v.stdout);
  await write('/tmp/pv/f/c.t', 'print "1..2\\nok 1\\nnot ok 2 - broken\\n";\n');
  const f = await run(['prove', 'f/'], { cwd: '/tmp/pv' });
  assert.notEqual(f.status, 0, `a failing test must fail prove: ${f.stdout}`);
  assert.match(f.stdout, /Failed test:\s+2/, f.stdout);
  const sel = await run(['perl', '-e', 'use IO::Select; pipe my $r1, my $w1; pipe my $r2, my $w2; syswrite $w2, "x"; my @ready = IO::Select->new($r1, $r2)->can_read(1); print scalar(@ready), " ", ($ready[0] == $r2 ? "r2" : "other"), "\\n"'], { cwd: '/tmp' });
  assert.equal(sel.stdout.trim(), '1 r2', `IO::Select->can_read over two pipes: rc=${sel.status} ${sel.stdout}${sel.stderr}`);
  console.log('prove: prove t/ (2 files, 5 tests) PASS, prove -v shows the TAP, a failing test fails; IO::Select->can_read picks the ready pipe (WASI fd_set)');
}
