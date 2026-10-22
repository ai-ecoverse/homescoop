export default async function (ctx) {
  const { run, assert } = ctx;
  const go = (argv) => run(argv, { cwd: '/tmp' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const timed = async (argv) => {
    const t0 = Date.now();
    const r = await go(argv);
    return { ...r, ms: Date.now() - t0 };
  };

  const free = await go(['flock', '-n', '/tmp/l', 'true']);
  assert.equal(free.status, 0, `flock -n on a free lock: ${free.stderr}`);

  const holder = timed(['flock', '-x', '/tmp/l', 'sleep', '4']);
  await sleep(1000);
  const busy = await go(['flock', '-n', '/tmp/l', 'true']);
  assert.equal(busy.status, 1, `flock -n while flock -x holds it: rc ${busy.status} ${busy.stderr}`);
  const busyE = await go(['flock', '-n', '-E', '9', '/tmp/l', 'true']);
  assert.equal(busyE.status, 9, '-E sets the conflict exit code');
  const wait1 = await timed(['flock', '-w', '1', '/tmp/l', 'true']);
  assert.equal(wait1.status, 1, `flock -w 1 times out: rc ${wait1.status} ${wait1.stderr}`);
  assert.ok(wait1.ms >= 900, `flock -w 1 waited ${wait1.ms} ms`);
  const blocked = await timed(['flock', '-s', '/tmp/l', '-c', 'echo got it']);
  const held = await holder;
  assert.equal(held.status, 0, `holder: ${held.stderr}`);
  assert.equal(blocked.status, 0, `a blocking flock gets the lock after release: ${blocked.stderr}`);
  assert.equal(blocked.stdout, 'got it\n');
  assert.ok(blocked.ms >= 500, `the blocking flock waited for the holder (${blocked.ms} ms)`);

  const after = await go(['flock', '-n', '/tmp/l', 'true']);
  assert.equal(after.status, 0, `flock -n after release: ${after.stderr}`);
  const rc = await go(['flock', '/tmp/l', 'bash', '-c', 'exit 7']);
  assert.equal(rc.status, 7, "flock returns the command's status");
  const w0 = await go(['flock', '-w', '0', '/tmp/l', 'true']);
  assert.equal(w0.status, 0);

  const nfRc = await go(['flock', '-F', '/tmp/l', 'bash', '-c', 'exit 7']);
  assert.equal(nfRc.status, 7, `flock -F returns the command's status: rc ${nfRc.status} ${nfRc.stderr}`);
  const nfC = await go(['flock', '-F', '/tmp/l', '-c', 'echo f']);
  assert.equal(nfC.status, 0, `flock -F -c runs the string: ${nfC.stderr}`);
  assert.equal(nfC.stdout, 'f\n');
  const nfHolder = go(['flock', '-F', '-x', '/tmp/l', 'sleep', '3']);
  await sleep(1000);
  const nfBusy = await go(['flock', '-n', '/tmp/l', 'true']);
  assert.equal(nfBusy.status, 1, `flock -n while flock -F holds it: rc ${nfBusy.status} ${nfBusy.stderr}`);
  const nfHeld = await nfHolder;
  assert.equal(nfHeld.status, 0, `flock -F holder: ${nfHeld.stderr}`);
  const nfAfter = await go(['flock', '-n', '/tmp/l', 'true']);
  assert.equal(nfAfter.status, 0, `flock -n after the -F holder ends: ${nfAfter.stderr}`);

  const vHolder = go(['flock', '-x', '/tmp/l', 'sleep', '3']);
  await sleep(500);
  const verbose = await go(['flock', '--verbose', '/tmp/l', 'true']);
  await vHolder;
  assert.equal(verbose.status, 0, `flock --verbose: ${verbose.stderr}`);
  const took = /getting lock took (\d+\.\d+) seconds/.exec(verbose.stdout);
  assert.ok(took, `flock --verbose reports the wait: ${JSON.stringify(verbose.stdout)}`);
  assert.ok(Number(took[1]) >= 1.0, `flock --verbose reports ${took[1]} s for a wait of about 2.5 s`);
  console.log(`flock: -n is rc 1 (and -E 9) while held, -w 1 times out after ${wait1.ms} ms, a blocking -s waits ${blocked.ms} ms then runs -c, rc passes through, the lock is free after release, -F runs the command in place and holds the lock while it runs, and --verbose reports a ${took[1]} s wait`);
}
