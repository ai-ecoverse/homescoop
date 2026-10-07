/** xxd checklist: hex dump round trip. */
export default async function (ctx) {
  const { run, write, assert } = ctx;

  await write('home/in.bin', 'AB\n');
  const dump = await run(['xxd', '/home/in.bin'], { cwd: '/home' });
  assert.equal(dump.status, 0, dump.stderr);
  assert.match(dump.stdout, /4142/);

  await write('home/in.hex', dump.stdout);
  const back = await run(['xxd', '-r', '/home/in.hex'], { cwd: '/home' });
  assert.equal(back.status, 0, back.stderr);
  assert.equal(back.stdout, 'AB\n');
}
