/** grep: match / no-match + locale path. */
export default async function (ctx) {
  const { run, write, assert } = ctx;

  await write('home/hay.txt', 'alpha\nbeta\ngamma\n');
  const hit = await run(['grep', 'beta', '/home/hay.txt'], { cwd: '/home' });
  assert.equal(hit.status, 0, `grep stderr=${hit.stderr}`);
  assert.equal(hit.stdout, 'beta\n');

  const miss = await run(['grep', 'delta', '/home/hay.txt'], { cwd: '/home' });
  assert.equal(miss.status, 1, 'no match must exit 1');

  const loc = await run(['grep', 'alpha', '/home/hay.txt'], {
    cwd: '/home',
    env: { LC_ALL: 'C' },
  });
  assert.equal(loc.status, 0, `LC_ALL=C grep stderr=${loc.stderr}`);
  assert.equal(loc.stdout, 'alpha\n');
}
