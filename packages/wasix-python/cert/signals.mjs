/**
 * wasix-python 3.14.2-16: signals during blocking calls (PEP 475).
 *
 * -16 is the first python on wasix-sysroot -22, whose slicc.libc marker
 * makes slicc-kernel >= 1.53.3 end an interrupted sleep/select/poll with
 * EINTR (-19+ libc semantics). CPython must absorb that:
 * - a signal whose handler returns (SIGALRM from setitimer at 0.2 s) does not
 *   shorten time.sleep(1.0), select.select(..., 1.0) or poll(1000): each
 *   resumes for the time left and takes ~1 s in all, with the handler run once;
 * - SIGINT (^C on the terminal) during time.sleep(5) raises
 *   KeyboardInterrupt right away.
 * Timings are checked with slack for the browser kernel.
 */
const RESUME = String.raw`
import json, os, select, signal, time
hits = []
signal.signal(signal.SIGALRM, lambda s, f: hits.append(time.monotonic()))
out = {}
def timed(name, call):
    hits.clear()
    t = time.monotonic()
    signal.setitimer(signal.ITIMER_REAL, 0.2)
    res = call()
    out[name] = [round(time.monotonic() - t, 3), len(hits), round(hits[0] - t, 3) if hits else None, res]
timed("sleep", lambda: time.sleep(1.0))
timed("select", lambda: select.select([], [], [], 1.0) == ([], [], []))
r, w = os.pipe()
p = select.poll()
p.register(r, select.POLLIN)
timed("poll", lambda: p.poll(1000) == [])
print(json.dumps(out))
`;

const INTERRUPT = String.raw`
import sys, time
t = time.monotonic()
print("sleeping", flush=True)
try:
    time.sleep(5)
    print("slept", round(time.monotonic() - t, 3), flush=True)
except KeyboardInterrupt:
    print("KeyboardInterrupt after", round(time.monotonic() - t, 3), flush=True)
    sys.exit(3)
`;

export default async function (ctx) {
  const { run, write, pty, assert } = ctx;
  await write('/home/sig_resume.py', RESUME);
  const r = await run(['python', '/home/sig_resume.py'], { cwd: '/home' });
  assert.equal(r.status, 0, `sig_resume.py: rc=${r.status}\n${r.stdout}\n${r.stderr}`);
  const o = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const [name, [elapsed, hits, at, ok]] of Object.entries(o)) {
    assert.equal(ok === null ? true : ok, true, `${name}: result ${JSON.stringify(o[name])}`);
    assert.equal(hits, 1, `${name}: SIGALRM handler ran ${hits} times`);
    assert.ok(at >= 0.15 && at <= 0.8, `${name}: SIGALRM at ${at} s`);
    assert.ok(elapsed >= 0.95 && elapsed <= 2.0, `${name}: took ${elapsed} s, PEP 475 resumes for the full 1 s`);
  }

  await write('/home/sig_int.py', INTERRUPT);
  const t = await pty(['python', '/home/sig_int.py'], {
    cols: 80,
    rows: 24,
    cwd: '/home',
    steps: [{ expect: 'sleeping' }, { sleepMs: 500 }, { write: '\x03' }, { expect: 'KeyboardInterrupt after', timeoutMs: 4000 }],
    timeoutMs: 6000,
  });
  assert.ok(!t.failedStep, `^C during time.sleep(5) did not raise KeyboardInterrupt in time:\n${t.out}`);
  const after = Number((t.out.match(/KeyboardInterrupt after ([0-9.]+)/) || [])[1]);
  assert.ok(after >= 0.4 && after < 2.5, `KeyboardInterrupt after ${after} s (^C at ~0.5 s of a 5 s sleep)`);
  assert.equal(t.status, 3, `exit status ${t.status}`);
  console.log(
    `signals: SIGALRM at ~0.2 s resumes sleep ${o.sleep[0]} s, select ${o.select[0]} s, poll ${o.poll[0]} s (handler once each); ` +
      `^C during sleep(5) → KeyboardInterrupt after ${after} s`,
  );
}
