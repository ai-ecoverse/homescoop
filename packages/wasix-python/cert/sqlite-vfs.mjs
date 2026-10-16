const SCRIPT = String.raw`
import json, os, signal, sqlite3, subprocess, sys, threading, time
D = os.path.join(os.getcwd(), "vfs.db")
mode = sys.argv[1] if len(sys.argv) > 1 else "parent"
def connect(timeout=0):
    return sqlite3.connect(D, timeout=timeout, isolation_level=None)
if mode == "hold":
    c = connect()
    c.execute("begin immediate")
    c.execute("insert into t values(-1)")
    print("held", flush=True)
    time.sleep(60)
    sys.exit(0)
if mode == "writer":
    c = connect(timeout=30)
    for i in range(25):
        c.execute("insert into t values(?)", (int(sys.argv[2]) * 100 + i,))
    sys.exit(0)
for f in (D, D + "-journal"):
    if os.path.exists(f):
        os.remove(f)
out = {}
a = connect()
a.execute("create table t(v)")
a.execute("begin immediate")
a.execute("insert into t values(1)")
b = connect()
try:
    b.execute("insert into t values(2)")
    out["same_process"] = "ok"
except sqlite3.OperationalError as e:
    out["same_process"] = str(e)
sibling = connect()
sibling.execute("select count(*) from t").fetchone()
sibling.close()
r = subprocess.run(["sqlite3", D, "insert into t values(3);"], capture_output=True, text=True)
out["after_sibling_close"] = [r.returncode != 0, "locked" in (r.stdout + r.stderr)]
a.execute("commit")
holder = subprocess.Popen([sys.executable, __file__, "hold"], stdout=subprocess.PIPE, text=True)
out["holder"] = holder.stdout.readline().strip()
try:
    b.execute("insert into t values(4)")
    out["while_child_holds"] = "ok"
except sqlite3.OperationalError as e:
    out["while_child_holds"] = str(e)
holder.send_signal(signal.SIGKILL)
holder.wait(timeout=30)
c = connect(timeout=10)
c.execute("insert into t values(5)")
out["after_kill"] = sorted(v for (v,) in c.execute("select v from t where v < 100"))
ws = [subprocess.Popen([sys.executable, __file__, "writer", str(k)]) for k in (1, 2, 3)]
out["writers"] = [w.wait(timeout=120) for w in ws]
def thread_writer(k):
    t = connect(timeout=30)
    for i in range(20):
        t.execute("insert into t values(?)", (1000 + k * 100 + i,))
    t.close()
ts = [threading.Thread(target=thread_writer, args=(k,)) for k in (1, 2, 3)]
[t.start() for t in ts]
[t.join() for t in ts]
out["counts"] = [c.execute("select count(*) from t where v >= 100 and v < 1000").fetchone()[0], c.execute("select count(*) from t where v >= 1000").fetchone()[0]]
out["integrity"] = c.execute("pragma integrity_check").fetchone()[0]
out["dotlock"] = os.path.exists(D + ".lock")
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/sqlite_vfs.py', SCRIPT);
  const r = await run(['python3', '/tmp/sqlite_vfs.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.same_process, 'database is locked', `a second connection in the same process must see the first one's write lock (stable st_ino): ${o}`);
  assert.deepEqual(out.after_sibling_close, [true, true], `closing a sibling connection must not drop the held lock (the VFS defers POSIX's release-on-close): ${o}`);
  assert.equal(out.holder, 'held', o);
  assert.equal(out.while_child_holds, 'database is locked', o);
  assert.deepEqual(out.after_kill, [1, 5], `a SIGKILLed holder's lock is released and its uncommitted row rolled back: ${o}`);
  assert.deepEqual(out.writers, [0, 0, 0], o);
  assert.deepEqual(out.counts, [75, 60], `3 processes x 25 and 3 threads x 20 inserts, none lost: ${o}`);
  assert.equal(out.integrity, 'ok', o);
  assert.equal(out.dotlock, false, o);
  console.log('sqlite unix VFS: a second connection in one process gets "database is locked"; a sibling open/close keeps the lock against the CLI; a SIGKILLed child holder releases it (rows [1, 5]); 3 processes x 25 and 3 threads x 20 inserts all land (75, 60), integrity ok, no .lock dir');
}
