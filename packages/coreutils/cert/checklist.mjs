/** coreutils: pipes + env/nice/nohup (cli profile / execve). */
export default async function (ctx) {
  const { run, write, assert } = ctx;

  // Pipes: bash pipeline through coreutils cat/echo.
  const pipe = await run(['bash', '-c', 'echo homescoop-pipe | cat'], { cwd: '/home' });
  assert.equal(pipe.status, 0, `pipe stderr=${pipe.stderr}`);
  assert.equal(pipe.stdout, 'homescoop-pipe\n');

  // env: set var for child printenv.
  const env = await run(['env', 'HOMESCOOP_CERT=yes', 'printenv', 'HOMESCOOP_CERT'], {
    cwd: '/home',
  });
  assert.equal(env.status, 0, `env stderr=${env.stderr}`);
  assert.equal(env.stdout, 'yes\n');

  // Locale path touches gnulib getlocalename (patch on emscripten).
  await write('home/a.txt', 'b\na\n');
  const sort = await run(['env', 'LC_ALL=C', 'sort', '/home/a.txt'], { cwd: '/home' });
  assert.equal(sort.status, 0, `sort stderr=${sort.stderr}`);
  assert.equal(sort.stdout, 'a\nb\n');

  // nice / nohup must exec a real child (not libstubs).
  const nice = await run(['nice', 'echo', 'nice-ok'], { cwd: '/home' });
  assert.equal(nice.status, 0, `nice stderr=${nice.stderr}`);
  assert.equal(nice.stdout, 'nice-ok\n');

  const nohup = await run(['nohup', 'echo', 'nohup-ok'], { cwd: '/home' });
  assert.equal(nohup.status, 0, `nohup stderr=${nohup.stderr}`);
  assert.equal(nohup.stdout, 'nohup-ok\n');
}
