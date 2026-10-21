export default async function (ctx) {
  const { run, pty, assert, addUser } = ctx;
  await addUser({ name: 'ed' });
  const w = await run(['bash', '-c', 'printf "a\\nb\\n" > /home/ed/f.txt'], { cwd: '/tmp', user: 'ed' });
  assert.equal(w.status, 0, `setup: ${w.stderr}`);
  const session = pty(['nano', '-G', 'f.txt'], {
    cwd: '/home/ed',
    user: 'ed',
    steps: [{ expect: 'f\\.txt' }, { sleepMs: 6000, write: '\x18' }],
  });
  await new Promise((r) => setTimeout(r, 1500));
  const lock = await run(['bash', '-c', 'test -f /home/ed/.f.txt.swp && echo present; od -An -c -j 28 -N 2 /home/ed/.f.txt.swp | tr -d " \\n"; echo'], { cwd: '/home/ed', user: 'ed' });
  const second = await pty(['nano', '-G', 'f.txt'], {
    cwd: '/home/ed',
    user: 'ed',
    steps: [{ expect: 'being edited by ed \\(with nano 8\\.7\\.1, PID' }, { write: 'n' }, { sleepMs: 500, write: '\x18' }],
  });
  const r = await session;
  assert.equal(r.status, 0, `nano -G: status=${r.status} failed=${JSON.stringify(r.failedStep)}`);
  assert.doesNotMatch(r.out ?? '', /Couldn't determine my identity/, `nano -G finds the user in /etc/passwd (homescoop#866; 8.7.1-5: "Couldn't determine my identity for lock file")`);
  assert.equal(lock.stdout, 'present\ned\n', `while nano -G is open, .f.txt.swp exists and names ed at nano's user-name offset (28): ${lock.stdout}${lock.stderr}`);
  assert.equal(second.status, 0, `a second nano -G f.txt warns that ed is editing it (homescoop#1451): status=${second.status} failed=${JSON.stringify(second.failedStep)}`);
  const gone = await run(['test', '-e', '/home/ed/.f.txt.swp'], { cwd: '/home/ed', user: 'ed' });
  assert.notEqual(gone.status, 0, 'the lock file is removed when nano exits');
  const insert = await pty(['nano', 'g.txt'], {
    cwd: '/home/ed',
    user: 'ed',
    steps: [
      { expect: '\\[ New File \\]' },
      { write: '\x12' },
      { expect: 'File to insert' },
      { write: '~ed/f.txt\r' },
      { expect: '\\[ Read 2 lines \\]' },
      { write: '\x0f' },
      { expect: 'Write to File: g\\.txt' },
      { write: '\r' },
      { expect: '\\[ Wrote 2 lines \\]' },
      { write: '\x18' },
    ],
  });
  assert.equal(insert.status, 0, `^R ~ed/f.txt expands ~ed through getpwent (homescoop#1451): status=${insert.status} failed=${JSON.stringify(insert.failedStep)}`);
  const g = await run(['base64', '-w0', '/home/ed/g.txt'], { cwd: '/home/ed', user: 'ed' });
  assert.equal(g.status, 0, `read g.txt: ${g.stderr}`);
  assert.equal(Buffer.from(g.stdout, 'base64').toString('latin1'), 'a\nb\n', 'g.txt holds f.txt, inserted through ~ed/');
  console.log('locking: nano -G as ed writes .f.txt.swp naming ed, a second nano -G warns that ed is editing it, the lock goes on ^X, and ^R ~ed/f.txt inserts it');
}
