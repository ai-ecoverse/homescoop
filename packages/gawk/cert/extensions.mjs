import { readFileSync } from 'node:fs';

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('home/f', '1\n2\n3\n');
  const go = (argv) => run(argv, { cwd: '/home' });
  const inplace = await go(['gawk', '-i', 'inplace', '{print $0*2}', 'f']);
  assert.equal(inplace.status, 2);
  assert.equal(inplace.stderr, "gawk: fatal: cannot open source file `inplace' for reading: No such file or directory\n");
  assert.equal((await go(['cat', 'f'])).stdout, '1\n2\n3\n', 'a failed -i inplace leaves the file alone');
  const lib = await go(['gawk', '-l', 'filefuncs', 'BEGIN{print 1}']);
  assert.equal(lib.status, 2);
  assert.equal(lib.stderr, "gawk: fatal: cannot open shared library `filefuncs' for reading: No such file or directory\n");
  const mpfr = await go(['gawk', '-M', 'BEGIN{print 2**70}']);
  assert.equal(mpfr.status, 0);
  assert.equal(mpfr.stderr, 'gawk: warning: -M ignored: MPFR/GMP support not compiled in\n');
  const alt = await go(['bash', '-c', "gawk '{print $0*2}' f > f.new && mv f.new f && cat f"]);
  assert.equal(alt.stdout, '2\n4\n6\n', `the README's -i inplace replacement: ${alt.stderr}`);
  const readme = readFileSync(new URL('../package/README.md', import.meta.url), 'utf8');
  assert.match(readme, /-i inplace/);
  assert.match(readme, /--disable-extensions/);
  assert.match(readme, /-M/);
  console.log('extensions: -i inplace, -l and -M fail as the README says (homescoop#681), and the README workaround edits the file');
}
