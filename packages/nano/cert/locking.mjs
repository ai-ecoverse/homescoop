export default async function (ctx) {
  const { run, pty, assert, addUser } = ctx;
  await addUser({ name: 'ed' });
  const w = await run(['bash', '-c', 'printf "a\\nb\\n" > /home/ed/f.txt'], { cwd: '/tmp', user: 'ed' });
  assert.equal(w.status, 0, `setup: ${w.stderr}`);
  const session = pty(['nano', '-G', 'f.txt'], {
    cwd: '/home/ed',
    user: 'ed',
    steps: [{ expect: 'f\\.txt' }, { sleepMs: 3000, write: '\x18' }],
  });
  await new Promise((r) => setTimeout(r, 1500));
  const lock = await run(['bash', '-c', 'test -f /home/ed/.f.txt.swp && echo present; od -An -c -j 28 -N 2 /home/ed/.f.txt.swp | tr -d " \\n"; echo'], { cwd: '/home/ed', user: 'ed' });
  const r = await session;
  assert.equal(r.status, 0, `nano -G: status=${r.status} failed=${JSON.stringify(r.failedStep)}`);
  assert.doesNotMatch(r.out ?? '', /Couldn't determine my identity/, `nano -G finds the user in /etc/passwd (homescoop#866; 8.7.1-5: "Couldn't determine my identity for lock file")`);
  assert.equal(lock.stdout, 'present\ned\n', `while nano -G is open, .f.txt.swp exists and names ed at nano's user-name offset (28): ${lock.stdout}${lock.stderr}`);
  const gone = await run(['test', '-e', '/home/ed/.f.txt.swp'], { cwd: '/home/ed', user: 'ed' });
  assert.notEqual(gone.status, 0, 'the lock file is removed when nano exits');
  console.log('locking: nano -G as ed writes .f.txt.swp naming ed while open and removes it on ^X');
}
