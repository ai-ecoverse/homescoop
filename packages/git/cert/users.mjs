/**
 * H1 (homescoop#207): git as root (the kernel's default) and as a user added
 * with kernel.users.add. Each inits and commits in its own home with no
 * "dubious ownership" error. Without user.name, the author name comes from
 * the kernel's /etc/passwd for the process's uid (shims/slicc: process
 * credentials, slicc_pwd's getpwuid).
 *
 * Needs slicc-kernel >= 1.47.1, whose Emscripten stat reports the caller's
 * euid/egid as file owner: on 1.44.0 every file is uid 1000, so root's own
 * repository is "dubious". On 2.55.0-13 (a repack of -11,
 * NEGATIVE.md) the author is "Unknown", since getpwuid found nobody.
 */
export default async function (ctx) {
  const { run, assert, addUser } = ctx;
  await addUser({ name: 'cone' });
  const script = [
    'cd ~ && git init -q repo && cd repo',
    'git config user.email "$USER@slicc.test"',
    'echo hi > f && git add f && git commit -qm first',
    'git log -1 --format="%an <%ae> %s"',
    'git status --short | wc -l',
    'git rev-parse --show-toplevel',
  ].join(' && ');
  const want = {
    root: ['root <root@slicc.test> first', '0', '/root/repo'],
    cone: ['cone <cone@slicc.test> first', '0', '/home/cone/repo'],
  };
  for (const user of ['root', 'cone']) {
    const r = await run(['bash', '-c', script], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    assert.equal(r.status, 0, `${user}: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr, /dubious ownership/, r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n').map((l) => l.trim()), want[user], `${user}:\n${r.stdout}${r.stderr}`);
  }
}
