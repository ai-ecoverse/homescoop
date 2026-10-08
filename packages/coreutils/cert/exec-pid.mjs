/**
 * coreutils exec keeps the pid (slicc-kernel#99): env and nice exec their
 * program, which then has their pid and bash's $$ as its parent. With the old
 * spawn-based exec the program is env's child, one pid further down.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  for (const tool of ['env', 'nice']) {
    const r = await run(
      ['bash', '-c', `echo $$; ${tool} bash -c 'echo $PPID'; true`],
      { cwd: '/home' },
    );
    assert.equal(r.status, 0, `${tool} stderr=${r.stderr}`);
    const [pid, ppid] = r.stdout.trim().split('\n');
    assert.equal(ppid, pid, `${tool} bash: $PPID ${ppid} should be the outer bash's ${pid}`);
  }
}
