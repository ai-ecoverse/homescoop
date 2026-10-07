/** sed: -i in-place + e (execute) command. */
export default async function (ctx) {
  const { run, write, read, assert } = ctx;

  await write('home/edit.txt', 'alpha\n');
  const inplace = await run(['sed', '-i', 's/alpha/beta/', '/home/edit.txt'], { cwd: '/home' });
  assert.equal(inplace.status, 0, `sed -i stderr=${inplace.stderr}`);
  assert.equal(await read('home/edit.txt'), 'beta\n');

  // e executes pattern-space as a shell command (cli profile popen).
  await write('home/cmd.txt', 'echo sed-e-ok\n');
  const exec = await run(['sed', 'e', '/home/cmd.txt'], { cwd: '/home' });
  assert.equal(exec.status, 0, `sed e stderr=${exec.stderr}`);
  assert.equal(exec.stdout, 'sed-e-ok\n');
}
