/**
 * bash /dev/tcp through the slicc socket shim (netfork profile, #140/#149):
 * connect() and getaddrinfo go to the kernel's sockets and resolver. The
 * fork profile 5.3.0-9 first built (and 5.3.0-8) answered every target
 * with "Host is unreachable" (Emscripten's WebSocket SOCKFS).
 * Needs "uplink": true (slicc-kernel >= 1.28.0) for the tailnet case.
 */
export default async function (ctx) {
  const { run, assert, serve, uplink } = ctx;
  const sh = (script) => run(['bash', '-c', script], { cwd: '/home' });

  // The far end of the realm proxy, and a tailnet peer.
  await serve(async (req) => ({ headers: [['content-type', 'text/plain']], body: `proxied ${new URL(req.url).pathname}\n` }));
  await uplink({
    names: { 'peer.tail1234.ts.net': ['100.64.1.2'] },
    peers: { '100.64.1.2:8080': { http: { body: 'hello tailnet\n' } } },
  });

  // A round trip with a kernel server: the realm proxy on 127.0.0.1:3128.
  const proxy = await sh('exec 3<>/dev/tcp/127.0.0.1/3128; printf "GET http://cert.test/hi HTTP/1.1\\r\\nHost: cert.test\\r\\nConnection: close\\r\\n\\r\\n" >&3; cat <&3');
  assert.equal(proxy.status, 0, `proxy round trip rc=${proxy.status} stderr=${proxy.stderr}`);
  assert.match(proxy.stdout, /^HTTP\/1\.1 200 OK\r\n/);
  assert.match(proxy.stdout, /\r\n\r\nc\r\nproxied \/hi\n\r\n0\r\n\r\n$/, `proxy body: ${JSON.stringify(proxy.stdout)}`);

  // $(hostname) resolves to the kernel's loopback: the proxy answers there too.
  const host = await sh('h=$(hostname); exec 3<>/dev/tcp/$h/3128 && printf "GET http://cert.test/byname HTTP/1.1\\r\\nHost: cert.test\\r\\nConnection: close\\r\\n\\r\\n" >&3; cat <&3');
  assert.equal(host.status, 0, `$(hostname) rc=${host.status} stderr=${host.stderr}`);
  assert.match(host.stdout, /proxied \/byname\n/);

  // Nothing listening: Connection refused.
  const refused = await sh('exec 3<>/dev/tcp/127.0.0.1/1');
  assert.equal(refused.status, 1, `refused rc=${refused.status}`);
  assert.match(refused.stderr, /\/dev\/tcp\/127\.0\.0\.1\/1: Connection refused/);

  // An unknown name: the resolver says so (not "Host is unreachable").
  const unknown = await sh('exec 3<>/dev/tcp/no.such.host.invalid/80');
  assert.equal(unknown.status, 1, `unknown rc=${unknown.status}`);
  assert.match(unknown.stderr, /no\.such\.host\.invalid: Name does not resolve/);
  assert.doesNotMatch(unknown.stderr, /Host is unreachable/);

  // A tailnet name: resolved and dialled through the uplink.
  const tail = await sh('exec 3<>/dev/tcp/peer.tail1234.ts.net/8080; printf "GET /x HTTP/1.1\\r\\nHost: peer\\r\\n\\r\\n" >&3; cat <&3');
  assert.equal(tail.status, 0, `tailnet rc=${tail.status} stderr=${tail.stderr}`);
  assert.equal(tail.stdout, 'HTTP/1.1 200 X\r\nContent-Length: 14\r\nConnection: close\r\n\r\nhello tailnet\n');
  const log = await ctx.uplinkLog();
  assert.ok(log.asked.some((a) => a.name === 'peer.tail1234.ts.net'), JSON.stringify(log.asked));
  assert.deepEqual(log.dialled.at(-1), { host: '100.64.1.2', port: 8080 });
  assert.match(log.requests.at(-1).head, /^GET \/x HTTP\/1\.1\r\nHost: peer$/);
}
