const SCRIPT = String.raw`
import json, signal, subprocess, sys, time
r = []
for d in (0.05, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.6):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
        time.sleep(d)
        p.send_signal(sig)
        t = time.monotonic()
        try:
            rc = p.wait(timeout=20)
        except subprocess.TimeoutExpired:
            p.kill()
            rc = "timeout"
        r.append([d, int(sig), rc, round(time.monotonic() - t, 1)])
print(json.dumps(r))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/startsignal.py', SCRIPT);
  const r = await run(['python3', '/tmp/startsignal.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const rows = JSON.parse(r.stdout.trim().split('\n').pop());
  for (const [d, sig, rc, waited] of rows) {
    assert.equal(rc, -sig, `a signal ${sig} sent ${d} s after spawning a python child ends it (slicc-kernel#755): ${JSON.stringify(rows)}`);
    assert.ok(waited < 10, `reaped in ${waited} s: ${JSON.stringify(rows)}`);
  }
  console.log(`SIGTERM and SIGKILL sent 0.05-0.6 s after spawning a python child (still starting) end it every time, rc -15 / -9, reaped at once (slicc-kernel#755, fixed in 1.104.1): ${JSON.stringify(rows)}`);
}
