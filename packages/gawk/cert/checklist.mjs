/** gawk: system / getline pipe / print|cmd (emscripten-no-fork-popen). */
export default async function (ctx) {
  const { run, assert } = ctx;

  const sys = await run(
    ['gawk', 'BEGIN { r = system("echo sys-ok"); print "status", r }'],
    { cwd: '/home' },
  );
  assert.equal(sys.status, 0, `system stderr=${sys.stderr}`);
  assert.match(sys.stdout, /sys-ok/);
  assert.match(sys.stdout, /status 0/);

  const getline = await run(
    ['gawk', 'BEGIN { "echo getline-ok" | getline line; print line; close("echo getline-ok") }'],
    { cwd: '/home' },
  );
  assert.equal(getline.status, 0, `getline stderr=${getline.stderr}`);
  assert.equal(getline.stdout, 'getline-ok\n');

  const printPipe = await run(
    ['gawk', 'BEGIN { print "print-pipe-ok" | "cat"; close("cat") }'],
    { cwd: '/home' },
  );
  assert.equal(printPipe.status, 0, `print|cmd stderr=${printPipe.stderr}`);
  assert.equal(printPipe.stdout, 'print-pipe-ok\n');
}
