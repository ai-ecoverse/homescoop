export default async function (ctx) {
  const { run, pty, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  await addUser({ name: 'scoop-a' });
  const as = (user, script) => run(['bash', '-c', script], { cwd: '/tmp', user });

  const s1 = await as('scoop-a', 'screen -dmS scoopsess sleep 60; echo rc=$?; sleep 0.5; screen -ls');
  assert.match(s1.stdout, /^rc=0\n/, `scoop-a -dmS: ${s1.stdout}${s1.stderr}`);
  assert.match(s1.stdout, /\d+\.scoopsess\t\(Detached\)/, `scoop-a -ls: ${s1.stdout}`);
  assert.match(s1.stdout, /1 Socket in \/home\/scoop-a\/\.screen\./, `scoop-a socket dir: ${s1.stdout}`);

  const c1 = await as('cone', 'screen -dmS conesess sleep 60; echo rc=$?; sleep 0.5; screen -ls; stat -c "%a %U %n" ~/.screen');
  assert.match(c1.stdout, /^rc=0\n/, `cone -dmS after scoop-a: ${c1.stdout}${c1.stderr}`);
  assert.match(c1.stdout, /\d+\.conesess\t\(Detached\)/, `cone -ls: ${c1.stdout}`);
  assert.doesNotMatch(c1.stdout, /scoopsess/, `cone sees scoop-a's session: ${c1.stdout}`);
  assert.match(c1.stdout, /^700 cone \/home\/cone\/\.screen$/m, `cone's socket dir: ${c1.stdout}`);

  const s2 = await as('scoop-a', 'screen -ls; echo rc=$?; SCREENDIR=/home/cone/.screen screen -ls; echo rc=$?; screen -S conesess -X quit; echo rc=$?');
  assert.doesNotMatch(s2.stdout, /conesess/, `scoop-a lists cone's session: ${s2.stdout}`);
  assert.match(s2.stdout + s2.stderr, /Cannot access \/home\/cone\/\.screen: Permission denied/, `scoop-a reads cone's socket dir: ${s2.stdout}${s2.stderr}`);
  assert.match(s2.stdout, /No screen session found\.\n(\r\n)?rc=1/, `scoop-a -X quit on cone's session: ${s2.stdout}`);

  for (const [user, target, other] of [['scoop-a', 'conesess', 'cone'], ['cone', 'scoopsess', 'scoop-a']]) {
    const t = await pty(['screen', '-r', target], { cwd: '/tmp', user, steps: [{ expect: 'There is no screen to be resumed matching' }], timeoutMs: 8000 });
    assert.ok(!t.failedStep, `${user} screen -r ${other}'s ${target}: ${JSON.stringify(t.out.slice(-300))}`);
    const x = await pty(['screen', '-x', target], { cwd: '/tmp', user, steps: [{ expect: 'There is no screen to be (resumed|attached) matching' }], timeoutMs: 8000 });
    assert.ok(!x.failedStep, `${user} screen -x ${other}'s ${target}: ${JSON.stringify(x.out.slice(-300))}`);
  }

  const c2 = await as('cone', 'screen -ls; screen -S conesess -X quit; echo rc=$?');
  assert.match(c2.stdout, /\d+\.conesess\t\(Detached\)/, `cone still has its session: ${c2.stdout}`);
  assert.match(c2.stdout, /rc=0$/, `cone quits its own: ${c2.stdout}${c2.stderr}`);
  const s3 = await as('scoop-a', 'screen -S scoopsess -X quit; echo rc=$?');
  assert.match(s3.stdout, /rc=0/, `scoop-a quits its own: ${s3.stdout}${s3.stderr}`);
  console.log('users: each user\'s sessions are in its own ~/.screen (700); scoop-a and cone cannot list, attach to (-r, -x) or quit each other\'s sessions; the second user to start screen still can');
}
