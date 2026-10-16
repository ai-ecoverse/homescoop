const SQL = String.raw`
import json, os, select, sqlite3, subprocess, time
D = "/tmp/lock_cli.db"
for f in (D, D + "-journal"):
    if os.path.exists(f):
        os.remove(f)
c = sqlite3.connect(D, timeout=0, isolation_level=None)
c.execute("create table t(v)")
c.execute("insert into t values(1)")
out = {}
c.execute("begin immediate")
c.execute("insert into t values(2)")
out["dotlock"] = os.path.exists(D + ".lock")
r = subprocess.run(["sqlite3", D, "insert into t values(3);"], capture_output=True, text=True)
out["cli_while_python_holds"] = [r.returncode != 0, "locked" in (r.stdout + r.stderr)]
c.execute("commit")
cli = subprocess.Popen(["sqlite3", D], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
cli.stdin.write("begin immediate;\ninsert into t values(4);\nselect 'held';\n")
cli.stdin.flush()
deadline = time.monotonic() + 30
fd, seen = cli.stdout.fileno(), ""
while "held" not in seen.split():
    ready, _, _ = select.select([fd], [], [], max(deadline - time.monotonic(), 0))
    chunk = os.read(fd, 4096).decode() if ready else ""
    if not chunk:
        cli.kill()
        raise SystemExit("sqlite3 CLI never reported 'held' within 30 s: rc=%r stderr=%r" % (cli.wait(), cli.stderr.read()))
    seen += chunk
try:
    c.execute("insert into t values(5)")
    out["python_while_cli_holds"] = "ok"
except sqlite3.OperationalError as e:
    out["python_while_cli_holds"] = str(e)
cli.stdin.write("commit;\n")
cli.stdin.close()
cli.wait(timeout=30)
out["rows"] = [v for (v,) in c.execute("select v from t order by v")]
print(json.dumps(out))
`;

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
  assert.match(out.held, /^child refused/, `another process got LOCK_EX while this one held it: this kernel has no slicc.fcntl_lock (slicc-kernel >= 1.100.0, #722, which engines requires since -22): ${JSON.stringify(out)}`);
  await write('/tmp/lock_cli.py', SQL);
  const q = await run(['python3', '/tmp/lock_cli.py'], { cwd: '/tmp' });
  assert.equal(q.status, 0, `rc=${q.status} stderr=${q.stderr}`);
  const sq = JSON.parse(q.stdout.trim().split('\n').pop());
  assert.equal(sq.dotlock, false, `python's sqlite must lock with fcntl (the unix VFS), not a .lock directory: ${JSON.stringify(sq)}`);
  assert.deepEqual(sq.cli_while_python_holds, [true, true], `the sqlite3 CLI must get "database is locked" while python holds BEGIN IMMEDIATE: ${JSON.stringify(sq)}`);
  assert.equal(sq.python_while_cli_holds, 'database is locked', JSON.stringify(sq));
  assert.deepEqual(sq.rows, [1, 2, 4], `no lost or extra row: ${JSON.stringify(sq)}`);
  console.log(`locks: fcntl.lockf(LOCK_EX) held by this process makes another process's LOCK_EX|LOCK_NB fail (${out.held}); after LOCK_UN it gets the lock; os.lockf exists; python's sqlite3 (unix VFS, no .lock dir) and the Emscripten sqlite3 CLI lock each other out both ways ("database is locked"), rows [1, 2, 4]`);
}
