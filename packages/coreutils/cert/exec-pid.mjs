/**
 * coreutils exec keeps the pid (slicc-kernel#99): env and nice exec their
 * program, which then has their pid and bash's $$ as its parent. With the old
 * spawn-based exec the program is env's child, one pid further down.
 */
const ppidOf = (text) => /^\d+ \(.*\) \S (\d+) /m.exec(text)?.[1];

export default async function (ctx) {
  const { run, assert } = ctx;
  for (const tool of [['env'], ['nice']]) {
    const r = await run(
      ['bash', '-c', `echo $$; ${tool.join(' ')} cat /proc/self/stat; true`],
      { cwd: '/home' },
    );
    assert.equal(r.status, 0, `${tool[0]} stderr=${r.stderr}`);
    const [pid, line] = r.stdout.split('\n');
    assert.equal(ppidOf(line), pid, `${tool[0]} cat: ppid should be bash's ${pid}: ${line}`);
  }
}
