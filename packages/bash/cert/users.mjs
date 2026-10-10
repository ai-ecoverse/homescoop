/**
 * H1 (homescoop#207): bash's ids, names and prompts come from slicc-kernel's
 * process credentials (shims/slicc/slicc_libc_gaps.c over
 * Module.sliccKernel.cred(); slicc-kernel >= 1.44.0), as root (the kernel's
 * default) and as a user added with kernel.users.add.
 *
 * On 5.3.0-12 (the negative, NEGATIVE.md) every process is uid 1000: root
 * gets `$UID 1000`, a `$` prompt and `\u` of whoever /etc/passwd lists as
 * 1000. File owners are the kernel's (1.44.0 stores none: uid 1000), so
 * they are not checked here.
 */
export default async function (ctx) {
  const { run, pty, assert, addUser } = ctx;
  const cone = await addUser({ name: 'cone' });
  assert.equal(cone.uid, 1000, JSON.stringify(cone));

  const script = [
    'echo "UID=$UID EUID=$EUID GROUPS=${GROUPS[*]} HOME=$HOME USER=$USER"',
    "PS1='\\u \\$'; echo \"prompt=${PS1@P}\"",
    'echo "tilde=$(cd ~ && pwd) root=$(echo ~root) cone=$(echo ~cone)"',
    'cd ~ && echo hi > made && read -r line < made && echo "made=$line"',
  ].join('; ');
  const want = {
    root: [
      'UID=0 EUID=0 GROUPS=0 HOME=/root USER=root',
      'prompt=root #',
      'tilde=/root root=/root cone=/home/cone',
      'made=hi',
    ],
    cone: [
      'UID=1000 EUID=1000 GROUPS=1000 100 HOME=/home/cone USER=cone',
      'prompt=cone $',
      'tilde=/home/cone root=/root cone=/home/cone',
      'made=hi',
    ],
  };
  for (const user of ['root', 'cone']) {
    const r = await run(['bash', '-c', script], { cwd: '/tmp', ...(user === 'cone' && { user }) });
    assert.equal(r.status, 0, `${user}: ${r.stdout}${r.stderr}`);
    assert.deepEqual(r.stdout.trim().split('\n'), want[user], `${user}:\n${r.stdout}${r.stderr}`);
  }

  // The interactive prompt: `#` for root, `$` for the user (bash's default PS1).
  for (const [user, sign] of [['root', '#'], ['cone', '$']]) {
    const t = await pty(['bash', '--norc', '-i'], {
      ...(user === 'cone' && { user }),
      cwd: '/tmp',
      env: { PS1: '[\\u]\\$ ' },
      steps: [{ expect: `\\[${user}\\]\\${sign} ` }, { write: 'exit\r' }],
      timeoutMs: 10000,
    });
    assert.ok(!t.failedStep && t.out.includes(`[${user}]${sign} `), `${user} prompt:\n${t.out}`);
  }
}
