/**
 * The strict half of cert/siginherit.mjs, on slicc-kernel 1.122.0, which
 * reports inherited ignores through sliccKernel.sigInherited() before the
 * program's constructors run (slicc-kernel#967). shims/slicc's constructor
 * seeds them into the sigaction table (homescoop#973), so a child bash's
 * trap -p shows the parent's ignore, as on Linux, two levels down too, and
 * only for the signals the parent ignored; a subshell's ignore does not leak. 5.3.0-19 has no constructor, and
 * its child prints nothing. Run from cert/meta.json extra_kernels.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const one = await run(['bash', '-c', `trap '' PIPE; bash -c 'trap -p PIPE TERM'`], { cwd: '/tmp' });
  assert.equal(one.status, 0, `${one.stdout}${one.stderr}`);
  assert.equal(one.stdout.trim(), "trap -- '' SIGPIPE", `the child bash shows the inherited SIGPIPE ignore, and no TERM trap: ${JSON.stringify(one.stdout)}`);

  const two = await run(['bash', '-c', `trap '' PIPE INT; bash -c "bash -c 'trap -p PIPE INT HUP'"`], { cwd: '/tmp' });
  assert.equal(two.status, 0, `${two.stdout}${two.stderr}`);
  assert.deepEqual(two.stdout.trim().split('\n').sort(), ["trap -- '' SIGINT", "trap -- '' SIGPIPE"], `a grandchild still sees both ignores: ${JSON.stringify(two.stdout)}`);

  const sibling = await run(['bash', '-c', `(trap '' PIPE; true); bash -c 'trap -p PIPE; echo rc=$?'`], { cwd: '/tmp' });
  assert.equal(sibling.stdout.trim(), 'rc=0', `an ignore set in a finished subshell is not inherited by a later child: ${JSON.stringify(sibling.stdout)}`);
}
