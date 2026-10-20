export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('home/p.txt', 'a1\nb\nfoo=bar\n');
  const go = (argv) => run(argv, { cwd: '/home' });
  const cases = [
    [['grep', '-P', '\\d', 'p.txt'], 'a1\n'],
    [['grep', '-oP', 'foo=\\K\\w+', 'p.txt'], 'bar\n'],
    [['grep', '-P', '(?<=a)1', 'p.txt'], 'a1\n'],
    [['grep', '-cP', '^\\w+$', 'p.txt'], '2\n'],
    [['grep', '-oP', '(?i)FOO(?==)', 'p.txt'], 'foo\n'],
  ];
  for (const [argv, want] of cases) {
    const r = await go(argv);
    assert.equal(r.stderr, '', `${argv.join(' ')}: ${r.stderr} (homescoop#680; 3.12.0-6: "grep: Perl matching not supported in a --disable-perl-regexp build", rc 2)`);
    assert.equal(r.status, 0, `${argv.join(' ')} rc`);
    assert.equal(r.stdout, want, argv.join(' '));
  }
  const miss = await go(['grep', '-P', '\\d{3}', 'p.txt']);
  assert.equal(miss.status, 1, `no match: ${miss.stderr}`);
  const bad = await go(['grep', '-P', '(', 'p.txt']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /missing closing parenthesis/);
  console.log('perl-regexp: grep -P \\d, -oP \\K, lookbehind, -cP, (?i) lookahead; no match rc 1; a bad pattern rc 2');
}
