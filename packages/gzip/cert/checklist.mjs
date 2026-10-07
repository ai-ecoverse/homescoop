/** gzip: round trip, zcat, corrupt input. */
export default async function (ctx) {
  const { run, write, assert } = ctx;

  await write('home/plain.txt', 'homescoop-gzip-cert\n');
  const z = await run(['gzip', '-k', '-f', '/home/plain.txt'], { cwd: '/home' });
  assert.equal(z.status, 0, `gzip stderr=${z.stderr}`);

  const gun = await run(['gunzip', '-c', '-f', '/home/plain.txt.gz'], { cwd: '/home' });
  assert.equal(gun.status, 0, `gunzip stderr=${gun.stderr}`);
  assert.equal(gun.stdout, 'homescoop-gzip-cert\n');

  const zcat = await run(['zcat', '/home/plain.txt.gz'], { cwd: '/home' });
  assert.equal(zcat.status, 0, `zcat stderr=${zcat.stderr}`);
  assert.equal(zcat.stdout, 'homescoop-gzip-cert\n');

  await write('home/bad.gz', 'not-a-gzip-stream');
  const bad = await run(['gunzip', '-c', '/home/bad.gz'], { cwd: '/home' });
  assert.notEqual(bad.status, 0, 'corrupt gzip must fail');
}
