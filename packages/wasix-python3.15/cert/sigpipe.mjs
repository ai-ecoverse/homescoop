const SCRIPT = String.raw`
import errno, http.client, http.server, json, os, signal, socket, threading
out = {"getsignal": signal.getsignal(signal.SIGPIPE) == signal.SIG_IGN}
r, w = os.pipe()
os.close(r)
try:
    os.write(w, b"x")
    out["pipe"] = "wrote"
except OSError as e:
    out["pipe"] = [type(e).__name__, e.errno == errno.EPIPE]
a, b = socket.socketpair()
b.close()
try:
    for _ in range(64):
        a.send(b"y" * 65536)
    out["socket"] = "sent"
except OSError as e:
    out["socket"] = type(e).__name__
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", str(4 << 20))
        self.end_headers()
        try:
            for _ in range(64):
                self.wfile.write(b"z" * 65536)
        except OSError as e:
            errors.append(type(e).__name__)
    def log_message(self, *a):
        pass
errors = []
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]
c = socket.create_connection(("127.0.0.1", port))
c.sendall(b"GET / HTTP/1.0\r\n\r\n")
c.recv(16)
c.close()
for _ in range(200):
    if errors:
        break
    threading.Event().wait(0.05)
conn = http.client.HTTPConnection("127.0.0.1", port, timeout=20)
conn.request("GET", "/")
resp = conn.getresponse()
body = resp.read()
out["server"] = [errors[:1], resp.status, len(body)]
srv.shutdown()
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/sigpipe.py', SCRIPT);
  const r = await run(['python3', '/tmp/sigpipe.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `python with SIGPIPE ignored must not be killed (slicc-kernel#810): rc=${r.status} stdout=${r.stdout} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.getsignal, true, `python starts with SIGPIPE ignored: ${o}`);
  assert.deepEqual(out.pipe, ['BrokenPipeError', true], o);
  assert.ok(['BrokenPipeError', 'ConnectionResetError'].includes(out.socket), o);
  assert.equal(out.server[0].length, 1, `the handler saw the disconnect as an OSError: ${o}`);
  assert.ok(['BrokenPipeError', 'ConnectionResetError'].includes(out.server[0][0]), o);
  assert.deepEqual(out.server.slice(1), [200, 4 << 20], `http.server serves the next client after a disconnect: ${o}`);
  const h = await run(['bash', '-c', "python3 -c 'import sys\nfor i in range(100000): print(i)' | head -c 5 >/dev/null; echo ${PIPESTATUS[0]}"], { cwd: '/tmp' });
  assert.notEqual(h.stdout.trim(), '141', `python | head: python is not killed by SIGPIPE: ${h.stdout}${h.stderr}`);
  console.log(`SIGPIPE ignored (slicc-kernel#810, kernel >= 1.106.2): os.write to a pipe without a reader raises BrokenPipeError (EPIPE), a socket whose peer closed raises ${out.socket}, http.server's handler gets ${out.server[0][0]} when a client disconnects mid-response and then serves the next client 200 with 4 MiB; python | head -c 5 exits ${h.stdout.trim()}, not 141`);
}
