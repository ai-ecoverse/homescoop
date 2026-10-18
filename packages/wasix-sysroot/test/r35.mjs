// slicc-kernel#975: sa_mask and SA_NODEFER, through libc's mask swap around
// the handler (wasix-sysroot -35). Needs the kernel's slicc.sigmask_set
// (1.93.0+); on a kernel without it nothing is masked, as before.
const NEW = [
  /^sa_mask USR2: usr1=2 usr2=1 usr2_inside=0 max_depth=1 order=(<><>2|<>2<>) after: usr1_blocked=0 usr2_blocked=0$/,
  'SA_NODEFER: usr1=2 usr2=1 usr2_inside=0 max_depth=2 order=<<>>2 after: usr1_blocked=0 usr2_blocked=0',
  'r35 done',
];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r35'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  console.log(r.stdout);
  // After the handler returns, the order of the two signals it held back is
  // the kernel's to pick (POSIX leaves it open): slicc-kernel#974 holds the
  // handler's own signal itself, so 1.123+ gives <>2<>, older ones <><>2 (#1057).
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, NEW.length, r.stdout);
  NEW.forEach((w, i) => (w instanceof RegExp ? assert.match(lines[i], w, r.stdout) : assert.equal(lines[i], w, r.stdout)));
  console.log(`r35 (${ctx.variant}, slicc-kernel ${ctx.kernelVersion}): a handler runs with its sa_mask (SIGUSR2 raised inside waits for it to return) and its own signal blocked (a nested SIGUSR1 runs after, depth 1); with SA_NODEFER the nested one runs at once (depth 2); both masks are back after`);
}
