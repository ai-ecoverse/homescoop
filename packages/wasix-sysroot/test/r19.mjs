/**
 * wasix-sysroot 2025.9.30-19: test/r19.c built against this sysroot, run on
 * the kernel's Node entry. On -18 (the negative, cert/NEGATIVE.md): raise()
 * never reaches the handler (thread_signal is not delivered), alarm(1) never
 * fires in sysroot/sysroot-eh/sysroot-exnref-eh (it_interval 0 cancels), and
 * a nanosleep a signal cut short reports success (sysroot) or ENOTSUP.
 *
 * With R19_SIGSTATE=1 (slicc-kernel with sigaction_set, slicc-kernel#260)
 * it also reads `r19 hold`'s dispositions from /proc/<pid>/status in bash.
 */
export default async function (ctx) {
  const { run, assert } = ctx;
  const r = await run(['r19'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `r19 rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'raise: rc=0 hits=1',
    'alarm 1: fired=~1s count=1',
    'setitimer 200+100ms: ticks=3..6 after-cancel=0',
    'nanosleep timer: rc=-1 errno=EINTR rem=~1.8s alrm=1',
    'r19 done',
  ], r.stdout);

  const k = await run(['bash', '-c', 'r19 sleep & sleep 0.5; kill -USR1 $!; wait'], { cwd: '/tmp' });
  assert.equal(k.stdout.trim(), 'nanosleep kill: rc=-1 errno=EINTR rem=~2.5s hits=1', `${k.stdout}${k.stderr}`);

  if (process.env.R19_SIGSTATE !== '1') return;
  const s = await run(['bash', '-c', 'r19 hold & sleep 1; cat /proc/$!/status; wait'], { cwd: '/tmp' });
  assert.equal(s.status, 0, `hold rc=${s.status} ${s.stdout} ${s.stderr}`);
  const field = (name) => BigInt(`0x${(new RegExp(`^${name}:\\s*([0-9a-f]+)`, 'm').exec(s.stdout) ?? [])[1]}`);
  const bit = (sig) => 1n << BigInt(sig - 1);
  // Linux numbers: USR1 10, USR2 12, ALRM 14, TERM 15.
  assert.equal(field('SigIgn') & bit(12), bit(12), `SigIgn lacks USR2\n${s.stdout}`);
  for (const sig of [10, 14, 15]) assert.equal(field('SigCgt') & bit(sig), bit(sig), `SigCgt lacks ${sig}\n${s.stdout}`);
}
