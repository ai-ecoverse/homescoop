const SCRIPT = String.raw`
import json, os, signal, threading, time
hits = []
signal.signal(signal.SIGUSR1, lambda s, f: hits.append(s))
signal.signal(signal.SIGUSR2, lambda s, f: hits.append(s))
signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGUSR1, signal.SIGUSR2})
out = {}
os.kill(os.getpid(), signal.SIGUSR2)
out["sigwait"] = int(signal.sigwait({signal.SIGUSR1, signal.SIGUSR2}))
os.kill(os.getpid(), signal.SIGUSR1)
i = signal.sigwaitinfo({signal.SIGUSR1})
out["sigwaitinfo"] = [i.si_signo, i.si_code]
t = time.monotonic()
out["timeout"] = [signal.sigtimedwait({signal.SIGUSR1}, 0.3), round(time.monotonic() - t, 1)]
threading.Timer(0.2, lambda: os.kill(os.getpid(), signal.SIGUSR1)).start()
t = time.monotonic()
i = signal.sigtimedwait({signal.SIGUSR1}, 5)
out["from_thread"] = [i.si_signo if i else None, time.monotonic() - t < 3]
out["handlers_ran"] = hits
print(json.dumps(out))
`;
const INHERIT = 'import json, signal; print(json.dumps([{signal.SIG_IGN: "ign", signal.SIG_DFL: "dfl"}.get(signal.getsignal(s), "handler") for s in (signal.SIGUSR2, signal.SIGTERM, signal.SIGINT)]))';

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/sigwait_check.py', SCRIPT);
  const r = await run(['python3', '/tmp/sigwait_check.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status}\n${r.stdout}\n${r.stderr}`);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  const s = JSON.stringify(o);
  assert.equal(o.sigwait, 12, `signal.sigwait takes the pending SIGUSR2: ${s}`);
  assert.deepEqual(o.sigwaitinfo, [10, 0], `sigwaitinfo: si_signo 10, si_code SI_USER (0): ${s}`);
  assert.equal(o.timeout[0], null, s);
  assert.ok(o.timeout[1] >= 0.3 && o.timeout[1] < 1.5, `sigtimedwait(0.3) times out on time: ${s}`);
  assert.deepEqual(o.from_thread, [10, true], `another thread's kill(getpid()) is taken: ${s}`);
  assert.deepEqual(o.handlers_ran, [], `no handler ran for a waited-for signal: ${s}`);
  const i = await run(['bash', '-c', `trap '' USR2 INT; exec python3 -c '${INHERIT}'`], { cwd: '/tmp' });
  assert.equal(i.status, 0, `${i.stdout}${i.stderr}`);
  assert.deepEqual(JSON.parse(i.stdout), ['ign', 'dfl', 'ign'], `under bash trap '' USR2 INT, signal.getsignal shows the inherited ignores (slicc.sigaction_inherited, slicc-kernel >= 1.108.0), and python leaves an ignored SIGINT alone: ${i.stdout}`);
  console.log(`sigwait family (wasix-sysroot -32, slicc.sigwait): sigwait 12, sigwaitinfo (10, SI_USER), sigtimedwait(0.3) None on time, another thread's kill taken, no handler run; under bash trap '' USR2 INT: getsignal SIG_IGN, SIG_DFL (TERM), SIG_IGN (INT, so no KeyboardInterrupt handler)`);
}
