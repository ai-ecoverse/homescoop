const SCRIPT = String.raw`
import json, os, signal, subprocess, sys, time
hits = []
signal.signal(signal.SIGUSR1, lambda s, f: hits.append(s))
out = {}
out["old"] = sorted(int(s) for s in signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGUSR1}))
os.kill(os.getpid(), signal.SIGUSR1)
t = time.monotonic()
time.sleep(0.5)
out["slept"] = round(time.monotonic() - t, 2) >= 0.45
out["pending"] = sorted(int(s) for s in signal.sigpending())
out["hits_blocked"] = len(hits)
child = subprocess.run([sys.executable, "-c", "import signal; print(sorted(int(s) for s in signal.pthread_sigmask(signal.SIG_BLOCK, set())))"], capture_output=True, text=True)
out["child_mask"] = child.stdout.strip()
out["unblock_old"] = sorted(int(s) for s in signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGUSR1}))
for _ in range(10000):
    pass
out["hits_after"] = len(hits)
out["pending_after"] = sorted(int(s) for s in signal.sigpending())
try:
    signal.sigtimedwait({signal.SIGUSR2}, 0.1)
    out["sigtimedwait"] = "ok"
except OSError as e:
    out["sigtimedwait"] = e.errno
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/sigmask_check.py', SCRIPT);
  const r = await run(['python3', '/tmp/sigmask_check.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status}\n${r.stdout}\n${r.stderr}`);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(o.old, [], `initial mask: ${r.stdout}`);
  assert.equal(o.slept, true, `a blocked SIGUSR1 interrupted time.sleep: ${r.stdout}`);
  assert.deepEqual(o.pending, [10], `sigpending while blocked: ${r.stdout}`);
  assert.equal(o.hits_blocked, 0, `the handler ran while SIGUSR1 was blocked: ${r.stdout}`);
  assert.deepEqual(o.unblock_old, [10], `mask before unblocking: ${r.stdout}`);
  assert.equal(o.hits_after, 1, `the handler did not run once after unblocking: ${r.stdout}`);
  assert.deepEqual(o.pending_after, [], `still pending after unblocking: ${r.stdout}`);
  assert.equal(o.sigtimedwait, 'ok', `sigtimedwait times out (None) through slicc.sigwait (wasix-sysroot -32, slicc-kernel >= 1.106.2); -24 and older: ENOSYS (52): ${r.stdout}`);
  console.log(`sigmask: ${r.stdout.trim()}`);
}
