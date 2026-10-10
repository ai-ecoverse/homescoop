/**
 * H1 (homescoop#207): ps names process owners from slicc-kernel's process
 * credentials (/proc/<pid>/status Uid:, slicc-kernel >= 1.44.0) and its
 * /etc/passwd, through shims/slicc/slicc_pwd.c, which procps now links with
 * --wrap=getpwuid,getpwnam,getpwent.
 *
 * On 4.0.5-2 (the negative, NEGATIVE.md) USER is the number: getpwuid was
 * Emscripten's stub.
 */
export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });

  for (const user of ['root', 'cone']) {
    const r = await run(['bash', '-c', 'ps -o user=,comm='], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    assert.equal(r.status, 0, `${user}: ${r.stdout}${r.stderr}`);
    const rows = r.stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).join(' '));
    assert.ok(rows.includes(`${user} ps`), `${user}:\n${r.stdout}${r.stderr}`);
  }

  // Root sees a process cone runs, under cone's name.
  const sleeper = run(['bash', '-c', 'sleep 3'], { cwd: '/tmp', user: 'cone' });
  await new Promise((r) => setTimeout(r, 800));
  const a = await run(['bash', '-c', 'ps aux'], { cwd: '/tmp' });
  await sleeper;
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.match(a.stdout, /^cone +\d+ .* sleep 3$/m, a.stdout);
  assert.match(a.stdout, /^root +\d+ .* ps aux$/m, a.stdout);
}
