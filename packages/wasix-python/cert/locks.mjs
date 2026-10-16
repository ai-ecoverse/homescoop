const SCRIPT = String.raw`
import fcntl, json, os, subprocess, sys, time
P = "/tmp/lock_target"
mode = sys.argv[1] if len(sys.argv) > 1 else "parent"
if mode == "child":
    fd = os.open(P, os.O_RDWR)
    try:
        fcntl.lockf(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print("child got")
    except OSError as e:
        print("child refused", e.errno)
    sys.exit(0)
out = {"lockf": hasattr(os, "lockf")}
fd = os.open(P, os.O_RDWR | os.O_CREAT | os.O_TRUNC, 0o644)
os.write(fd, b"x" * 10)
fcntl.lockf(fd, fcntl.LOCK_EX)
out["held"] = subprocess.run([sys.executable, __file__, "child"], capture_output=True, text=True).stdout.strip()
fcntl.lockf(fd, fcntl.LOCK_UN)
out["released"] = subprocess.run([sys.executable, __file__, "child"], capture_output=True, text=True).stdout.strip()
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/lock_check.py', SCRIPT);
  const r = await run(['python3', '/tmp/lock_check.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.lockf, true, JSON.stringify(out));
  assert.equal(out.released, 'child got', JSON.stringify(out));
  if (out.held.startsWith('child refused')) {
    console.log(`locks: fcntl.lockf(LOCK_EX) held by this process makes another process's LOCK_EX|LOCK_NB fail (${out.held}); after LOCK_UN it gets the lock; os.lockf exists`);
  } else {
    assert.equal(out.held, 'child got', JSON.stringify(out));
    assert.ok(process.env.PY_LOCKS !== '1', `PY_LOCKS=1 needs slicc.fcntl_lock (slicc-kernel#722): ${JSON.stringify(out)}`);
    console.log('locks: no slicc.fcntl_lock in this kernel: every lock is granted locally (the other process gets LOCK_EX too), as up to -20; os.lockf exists');
  }
}
