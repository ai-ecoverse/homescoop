export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('home/e.txt', 'foo123\nab\n');
  const go = (argv) => run(argv, { cwd: '/home' });
  const warn = (cmd, opt) => `${cmd}: warning: ${cmd} is obsolescent; using grep ${opt}\n`;
  const cases = [
    [['egrep', 'a|z', 'e.txt'], 0, 'ab\n', warn('egrep', '-E')],
    [['egrep', '-o', '[0-9]{3}', 'e.txt'], 0, '123\n', warn('egrep', '-E')],
    [['fgrep', 'a.', 'e.txt'], 1, '', warn('fgrep', '-F')],
    [['fgrep', '-x', 'ab', 'e.txt'], 0, 'ab\n', warn('fgrep', '-F')],
    [['grep', 'a|z', 'e.txt'], 1, '', ''],
  ];
  for (const [argv, status, stdout, stderr] of cases) {
    const r = await go(argv);
    assert.equal(r.stdout, stdout, `${argv.join(' ')} stdout (homescoop#645; 3.12.0-6 ran egrep/fgrep as plain grep)`);
    assert.equal(r.status, status, `${argv.join(' ')} rc`);
    assert.equal(r.stderr, stderr, `${argv.join(' ')} stderr`);
  }
  console.log('egrep-fgrep: egrep is grep -E and fgrep is grep -F, with upstream\'s obsolescence warning; grep stays BRE');
}
