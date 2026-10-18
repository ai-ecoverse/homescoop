const SCRIPT = String.raw`
import json, multiprocessing as mp, os, socket, tempfile
def unix_names():
    d = tempfile.mkdtemp()
    p = os.path.join(d, "s")
    srv = socket.socket(socket.AF_UNIX)
    srv.bind(p)
    srv.listen(1)
    cli = socket.socket(socket.AF_UNIX)
    cli.connect(p)
    conn, peer = srv.accept()
    cli.sendall(b"ping")
    got = conn.recv(4)
    names = [srv.getsockname() == p, cli.getpeername() == p, peer, conn.getsockname() == p, cli.getsockname(), got.decode()]
    for s in (conn, cli, srv):
        s.close()
    return names
def bump(v, lst):
    v.value += 5
    lst.append("child")
if __name__ == "__main__":
    out = {"unix": unix_names()}
    with mp.Manager() as m:
        d = m.dict()
        d["a"] = 1
        l = m.list([1, 2])
        l.append(3)
        q = m.Queue()
        q.put(5)
        ns = m.Namespace(x=7)
        out["manager"] = [dict(d), list(l), q.get(timeout=10), ns.x, isinstance(m.address, str) and m.address.startswith("/")]
        v = m.Value("i", 1)
        shared = m.list()
        p = mp.Process(target=bump, args=(v, shared))
        p.start()
        p.join()
        out["advice"] = [v.value, list(shared), p.exitcode]
    print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/mp_manager.py', SCRIPT);
  const r = await run(['python3', '/tmp/mp_manager.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.unix, [true, true, '', true, '', 'ping'], `getsockname/getpeername of a path-bound AF_UNIX socket must give its path, an unbound client '': ${o}`);
  assert.deepEqual(out.manager, [{ a: 1 }, [1, 2, 3], 5, 7, true], o);
  assert.deepEqual(out.advice, [6, ['child'], 0], `the advice of the shared-ctypes error: a Manager Value and list passed to a spawned child carry its writes back (homescoop#669): ${o}`);
  assert.doesNotMatch(r.stderr, /Traceback/, `no traceback at exit (the Listener's unlink of its socket path): ${r.stderr}`);
  console.log('multiprocessing.Manager over AF_UNIX: getsockname/getpeername/accept give the path (an unbound client \'\'), a managed dict, list, Queue and Namespace work across the manager process, a Manager Value and list passed to a spawned child come back as 6 and [\'child\'], and nothing is printed at exit');
}
