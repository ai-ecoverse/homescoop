const SCRIPT = String.raw`
import ctypes, json, multiprocessing as mp, os, subprocess, sys, threading
def square(x):
    return x * x
def has_fork(_):
    import os
    return hasattr(os, "fork")
def feed(q):
    for i in range(3):
        q.put(i)
def bump(lock, path):
    for _ in range(20):
        with lock:
            with open(path) as f:
                n = int(f.read())
            with open(path, "w") as f:
                f.write(str(n + 1))
def attempt(f):
    try:
        return ["ok", f()]
    except Exception as e:
        return [type(e).__name__, str(e)]
if __name__ == "__main__":
    out = {"executable": sys.executable, "hasattr": hasattr(os, "fork"), "methods": sorted(mp.get_all_start_methods()), "start": mp.get_start_method()}
    pid = os.fork()
    if pid == 0:
        os._exit(7)
    _, st = os.waitpid(pid, 0)
    out["fork"] = os.waitstatus_to_exitcode(st)
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:
        got = []
        t = threading.Thread(target=lambda: got.append(sum(range(10))))
        t.start(); t.join()
        os.write(w, str(got[0]).encode())
        os._exit(0)
    os.close(w)
    os.waitpid(pid, 0)
    out["thread_in_child"] = int(os.read(r, 16))
    import numpy as np
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.write(w, json.dumps(np.linalg.solve(np.array([[2.0, 1.0], [1.0, 3.0]]), np.array([3.0, 5.0])).round(6).tolist()).encode())
        os._exit(0)
    os.close(w)
    os.waitpid(pid, 0)
    out["numpy_in_child"] = json.loads(os.read(r, 256))
    fx = mp.get_context("fork")
    with fx.Pool(2) as p:
        out["fork_pool"] = p.map(square, range(6))
    q = fx.Queue()
    c = fx.Process(target=feed, args=(q,))
    c.start()
    out["fork_queue"] = [q.get(timeout=20) for _ in range(3)]
    c.join()
    out["fork_queue_exit"] = c.exitcode
    path = "/tmp/fork_lock_counter"
    with open(path, "w") as f:
        f.write("0")
    lock = fx.Lock()
    ps = [fx.Process(target=bump, args=(lock, path)) for _ in range(3)]
    [x.start() for x in ps]
    [x.join() for x in ps]
    out["fork_lock"] = int(open(path).read())
    with mp.get_context("spawn").Pool(2) as p:
        out["spawn_pool"] = [p.map(square, range(4)), p.map(has_fork, range(2))]
    out["cdll_fork"] = attempt(lambda: ctypes.CDLL(None).fork)[0]
    out["child_env"] = subprocess.run([sys.executable, "-c", "import os; print(hasattr(os, 'fork'))"], capture_output=True, text=True).stdout.strip()
    env = {k: v for k, v in os.environ.items() if k != "PYTHON_FORK"}
    out["child_no_env"] = subprocess.run([sys.executable, "-c", "import os; print(hasattr(os, 'fork'))"], capture_output=True, text=True, env=env).stdout.strip()
    print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/fork_rows.py', SCRIPT);
  const r = await run(['python3', '/tmp/fork_rows.py'], { cwd: '/tmp', env: { PYTHON_FORK: 'true' } });
  assert.equal(r.status, 0, `rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.hasattr, true, `PYTHON_FORK=true runs bin/python-fork.wasm (slicc.commands variants): ${o}`);
  assert.deepEqual(out.methods, ['fork', 'forkserver', 'spawn'], o);
  assert.equal(out.start, 'spawn', `spawn stays the default start method: ${o}`);
  assert.equal(out.fork, 7, o);
  assert.equal(out.thread_in_child, 45, o);
  assert.deepEqual(out.numpy_in_child, [0.8, 1.4], o);
  assert.deepEqual(out.fork_pool, [0, 1, 4, 9, 16, 25], o);
  assert.deepEqual(out.fork_queue, [0, 1, 2], o);
  assert.equal(out.fork_queue_exit, 0, o);
  assert.equal(out.fork_lock, 60, `3 forked processes x 20 locked increments: ${o}`);
  assert.deepEqual(out.spawn_pool, [[0, 1, 4, 9], [true, true]], `spawn works, and its workers (sys.executable) run the fork build too: ${o}`);
  assert.equal(out.cdll_fork, 'AttributeError', `ctypes.CDLL(None).fork isn't exported, so no trap: ${o}`);
  assert.equal(out.child_env, 'True', `a child of sys.executable inherits PYTHON_FORK=true: ${o}`);
  assert.equal(out.child_no_env, 'False', `without PYTHON_FORK the child is the default build: ${o}`);
  const d = await run(['python3', '-c', 'import os; print(hasattr(os, "fork"))'], { cwd: '/tmp' });
  assert.equal(d.stdout.trim(), 'False', `without PYTHON_FORK, python3 is the default build: ${d.stdout}${d.stderr}`);
  const p = await run(['bash', '-c', 'PYTHON_FORK=true /usr/bin/python3 -c "import os; print(hasattr(os, \'fork\'))"; PYTHON_FORK=true pip --version >/dev/null && echo pip-ok'], { cwd: '/tmp' });
  assert.equal(p.stdout, 'True\npip-ok\n', `the /usr/bin entry and pip honour PYTHON_FORK too: ${p.stdout}${p.stderr}`);
  console.log(`PYTHON_FORK=true (bin/python-fork.wasm through slicc.commands variants): os.fork + waitpid (exit 7), a thread in a forked child, numpy in a forked child, get_context("fork") Pool.map / Queue [0, 1, 2] / Lock 3 x 20 = 60, spawn Pool whose workers are the fork build too, spawn the default start method, ctypes.CDLL(None).fork AttributeError (no trap), sys.executable children inherit the choice and drop it without the variable; /usr/bin/python3 and pip honour it`);
}
