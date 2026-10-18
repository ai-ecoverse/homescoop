const PIPE_IGNORED = "trap -- '' SIGPIPE";

export default async function (ctx) {
  const { run, assert } = ctx;
  const outer = `trap '' PIPE; bash -c 'trap -p PIPE; echo child-rc=$?'; echo parent-rc=$?`;
  const r = await run(['bash', '-c', outer], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stderr, /RuntimeError|unreachable|Aborted/, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.at(-1), 'parent-rc=0', r.stdout);
  assert.equal(lines.at(-2), 'child-rc=0', r.stdout);
  const shown = lines.slice(0, -2).join('\n');
  if (shown === '') {
    console.log("siginherit: this kernel has no sliccKernel.sigInherited (homescoop#973), so the child starts with default dispositions and trap -p PIPE prints nothing; nothing traps");
  } else {
    assert.equal(shown, PIPE_IGNORED, `an inherited SIGPIPE ignore shows in the child's trap -p: ${r.stdout}`);
    console.log(`siginherit: the child sees the inherited ignore: ${shown}`);
  }
  const own = await run(['bash', '-c', "trap '' PIPE; trap -p PIPE"], { cwd: '/tmp' });
  assert.equal(own.status, 0, own.stderr);
  assert.equal(own.stdout.trim(), PIPE_IGNORED, 'a trap set in the same shell always shows');
  const dfl = await run(['bash', '-c', 'trap -p PIPE; echo rc=$?'], { cwd: '/tmp' });
  assert.equal(dfl.stdout.trim(), 'rc=0', `no inherited ignore without one in the parent: ${dfl.stdout}`);
}
