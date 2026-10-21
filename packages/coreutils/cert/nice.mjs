export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const rows = [
    ['nice', '0\n'],
    ['nice -n 0 nice', '0\n'],
    ['nice -n 5 nice', '5\n'],
    ['nice nice', '10\n'],
    ['nice -n 5 nice -n 3 nice', '8\n'],
    ['nice -n 40 nice', '19\n'],
    ["nice -n 5 bash -c 'nice; nice -n 2 nice'", '5\n7\n'],
    ['nice -n 5 true; echo rc=$?', 'rc=0\n'],
    ['nice -n 5 false; echo rc=$?', 'rc=1\n'],
    ['env -i nice -n 4 nice', '4\n'],
  ];
  for (const user of ['root', 'cone']) {
    const sh = (cmd) => run(['bash', '-c', cmd], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    for (const [cmd, want] of rows) {
      const r = await sh(cmd);
      assert.deepEqual([r.stdout, r.stderr], [want, ''], `${user}: ${cmd} prints ${JSON.stringify(want)} with no warning, as GNU nice on Linux; Emscripten's getpriority stub made every niceness 20 and its setpriority stub refused every change (homescoop#863): ${JSON.stringify(r)}`);
    }
    const down = await sh('nice -n -1 nice; echo rc=$?; nice -n 5 nice -n -2 nice');
    if (user === 'root') {
      assert.deepEqual([down.stdout, down.stderr], ['-1\nrc=0\n3\n', ''], `root lowers its niceness: ${JSON.stringify(down)}`);
    } else {
      assert.equal(down.stdout, '0\nrc=0\n5\n', `cone can't lower its niceness, and nice still runs the command: ${JSON.stringify(down)}`);
      const warns = down.stderr.split('\n').filter(Boolean);
      assert.equal(warns.length, 2, `two warnings: ${JSON.stringify(down.stderr)}`);
      for (const w of warns) assert.match(w, /^nice: cannot set niceness: (Operation not permitted|Permission denied)$/, JSON.stringify(down.stderr));
    }
  }
  console.log('nice: niceness starts at 0, nice -n N adds N (default 10, at most 19), children inherit it (through bash too), the command runs and keeps its status; root may lower it, cone gets "cannot set niceness" and the command still runs');
}
