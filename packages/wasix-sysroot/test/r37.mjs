// homescoop#1059: sigsetjmp/siglongjmp in the EH trees (-36).
const EH = [
  'plain: sigsetjmp=3 after 1',
  'mask restored by siglongjmp: sigsetjmp=4 usr2_blocked=0',
  'handler save=1: sigsetjmp=7 hits=1 usr1_blocked=0 usr2_blocked=0',
  // savemask 0: the handler's mask (its own signal and sa_mask) stays, as on Linux.
  'handler save=0: sigsetjmp=7 hits=2 usr1_blocked=1 usr2_blocked=1',
  'r37 done',
];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r37'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} ${r.stdout}${r.stderr}`);
  const want = ctx.variant === 'noeh' ? ['no sigsetjmp in this tree', 'r37 done'] : EH;
  assert.deepEqual(r.stdout.trim().split('\n'), want, r.stdout);
  console.log(`r37 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): ${ctx.variant === 'noeh' ? 'asyncify tree, no sigsetjmp' : 'siglongjmp lands at its sigsetjmp, plain and out of a SIGUSR1 handler (sa_mask SIGUSR2); savemask 1 puts the mask back (nothing blocked after), savemask 0 keeps the handler mask'}`);
}
