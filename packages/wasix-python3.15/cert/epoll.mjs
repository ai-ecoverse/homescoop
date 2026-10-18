const SCRIPT = String.raw`
import asyncio, errno, json, os, select, selectors
out = {"selector": type(selectors.DefaultSelector()).__name__}
r2, w2 = os.pipe()
r, w = os.pipe()
os.write(w, b"x")
p = select.poll()
p.register(r, select.POLLIN)
p.register(r2, 0)
try:
    out["poll"] = p.poll(100)
except OSError as e:
    out["poll"] = errno.errorcode[e.errno]
try:
    ep = select.epoll()
except OSError as e:
    ep = None
    out["epoll"] = errno.errorcode[e.errno]
if ep:
    ep.register(r, select.EPOLLIN)
    out["ready"] = ep.poll(1) == [(r, select.EPOLLIN)]
    for what, f in (("register_twice", lambda: ep.register(r)), ("unregister", lambda: ep.unregister(r)), ("unregister_again", lambda: ep.unregister(r))):
        try:
            f()
            out[what] = 0
        except OSError as e:
            out[what] = errno.errorcode[e.errno]
async def handle(reader, writer):
    writer.write((await reader.read(5)).upper())
    await writer.drain()
    writer.close()
async def main():
    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(b"hello")
    await writer.drain()
    out["echo"] = (await asyncio.wait_for(reader.read(5), 10)).decode()
    writer.close()
    server.close()
    out["sleep"] = await asyncio.wait_for(asyncio.sleep(0.2, "slept"), 5)
asyncio.run(main())
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/epoll_check.py', SCRIPT);
  const r = await run(['python3', '/tmp/epoll_check.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepEqual(out.poll, [[out.poll?.[0]?.[0], 1]], `select.poll with an events-0 fd: ${JSON.stringify(out)}`);
  assert.equal(out.echo, 'HELLO', JSON.stringify(out));
  assert.equal(out.sleep, 'slept', JSON.stringify(out));
  if (out.epoll === 'ENOSYS') {
    assert.equal(out.selector, 'PollSelector', JSON.stringify(out));
    console.log(`epoll: no WASIX epoll in this kernel (ENOSYS), asyncio runs on PollSelector; select.poll takes an fd with events 0; asyncio echo + sleep`);
    return;
  }
  assert.equal(out.selector, 'EpollSelector', JSON.stringify(out));
  assert.equal(out.ready, true, JSON.stringify(out));
  assert.equal(out.register_twice, 'EEXIST', `register twice must be EEXIST: ${JSON.stringify(out)}`);
  assert.equal(out.unregister, 0, JSON.stringify(out));
  assert.equal(out.unregister_again, 'ENOENT', `unregister of an unregistered fd must be ENOENT: ${JSON.stringify(out)}`);
  console.log(`epoll: asyncio on EpollSelector (echo over loopback, sleep); select.epoll register twice EEXIST, unregister again ENOENT; select.poll takes an fd with events 0`);
}
