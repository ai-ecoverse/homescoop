const SCRIPT = String.raw`
import json, os, tempfile, threading
from multiprocessing.connection import Client, Listener
if __name__ == "__main__":
    path = os.path.join(tempfile.mkdtemp(), "listener")
    out = {}
    listener = Listener(path, "AF_UNIX")
    def client():
        with Client(path, "AF_UNIX") as c:
            c.send({"hello": [1, 2]})
            out["reply"] = c.recv()
    t = threading.Thread(target=client)
    t.start()
    with listener.accept() as conn:
        out["got"] = conn.recv()
        conn.send("ok")
    t.join()
    try:
        listener.close()
        out["close"] = "ok"
    except OSError as e:
        out["close"] = "%s: %s" % (type(e).__name__, e)
    print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/mp_listener.py', SCRIPT);
  const r = await run(['python3', '/tmp/mp_listener.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.got, { hello: [1, 2] }, o);
  assert.equal(out.reply, 'ok', o);
  assert.equal(out.close, 'ok', `Listener.close() must not fail on the socket path slicc-kernel keeps out of the filesystem (slicc-kernel#753): ${o}`);
  assert.doesNotMatch(r.stderr, /Traceback/, r.stderr);
  console.log('multiprocessing.connection over AF_UNIX: a Client sends a pickled dict to a Listener on a path and gets a reply; Listener.close() succeeds (the cert kernel keeps the socket path out of the filesystem, slicc-kernel#753 before 1.103.1)');
}
