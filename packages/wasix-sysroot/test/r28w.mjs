export const build = { asyncify: true };

const KERNEL = [
  'pselect pending: -1 EINTR handler=1 fast still_blocked=1',
  'sigsuspend: -1 EINTR handler=1 fast still_blocked=1',
  'agent HUP: -1 EINTR handler=1 fast',
  'agent TERM: -1 EINTR handler=1 fast',
  'agent rounds: 8/8',
  'ssh INT: -1 EINTR handler=1 fast still_blocked=1',
  'ppoll ready: 1 revents=IN',
];

const TAIL = [
  'sigtimedwait: -1 Function not implemented',
  'sigwaitinfo: -1 Function not implemented',
  'sigwait: Function not implemented sig=-7',
  'r28w done',
];

export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r28w'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const [masks, head, ...lines] = r.stdout.trim().split('\n');
  const kernel = head === 'kernel sigmask_poll: yes';
  if (process.env.R28_KERNEL_MASK === '1') assert.ok(kernel, `R28_KERNEL_MASK=1 but ${head}`);
  assert.deepEqual(lines.slice(-TAIL.length), TAIL, r.stdout);
  if (kernel) {
    assert.deepEqual(lines.slice(0, -TAIL.length), KERNEL, r.stdout);
    console.log(`r28w (${ctx.variant}): slicc.sigmask_poll: pselect with a pending blocked signal is EINTR at once with the handler run; sigsuspend wakes on a signal; gpg-agent's pselect(sigmask) gets HUP and TERM and ssh's ppoll(osigset) INT at once; masks are restored; sigtimedwait/sigwaitinfo/sigwait are ENOSYS`);
  } else if (masks === 'kernel sigmask_set: yes') {
    assert.equal(head, 'kernel sigmask_poll: no', r.stdout);
    assert.deepEqual(lines.slice(0, -TAIL.length), KERNEL, r.stdout);
    console.log(`r28w (${ctx.variant}): kernel masks without slicc.sigmask_poll: the libc's swap-and-poll fallback gives the same results (pselect pending EINTR, sigsuspend, gpg-agent HUP/TERM and ssh INT at once, masks restored); sigtimedwait/sigwaitinfo/sigwait are ENOSYS`);
  } else {
    assert.equal(masks, 'kernel sigmask_set: no', r.stdout);
    assert.equal(head, 'kernel sigmask_poll: no', r.stdout);
    assert.ok(lines.some((l) => l.startsWith('sigsuspend: -1 EINTR handler=1')), `sigsuspend still wakes on a signal: ${r.stdout}`);
    assert.ok(lines.includes('ppoll ready: 1 revents=IN'), r.stdout);
    console.log(`r28w (${ctx.variant}): a kernel without slicc.sigmask_poll: sigsuspend and ppoll work, signals are delivered as before; sigtimedwait/sigwaitinfo/sigwait are ENOSYS`);
  }
}
