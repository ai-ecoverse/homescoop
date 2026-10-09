/**
 * gawk /inet/tcp special files through the slicc socket shim (clinet
 * profile, #140/#149): connect() and getaddrinfo go to the kernel's sockets
 * and resolver. 5.4.1-1 (cli profile) failed every target, even a numeric
 * IP ("invalid: Name does not resolve"). Command coprocesses ("cmd" |&)
 * stay unsupported (emscripten-no-fork-popen.patch, PIPES_SIMULATED).
 * Needs "uplink": true (slicc-kernel >= 1.28.0).
 */
export default async function (ctx) {
  const { run, assert, serve, uplink } = ctx;
  const aw = (prog) => run(['gawk', prog], { cwd: '/home' });

  await serve(async (req) => ({ headers: [['content-type', 'text/plain']], body: `proxied ${new URL(req.url).pathname}\n` }));
  await uplink({
    names: { 'peer.tail1234.ts.net': ['100.64.1.2'] },
    peers: { '100.64.1.2:8080': { http: { body: 'hello tailnet\n' } } },
  });

  // A kernel server: the realm proxy on 127.0.0.1:3128, line by line.
  const proxy = await aw(
    'BEGIN { s = "/inet/tcp/0/127.0.0.1/3128"; printf "GET http://cert.test/awk HTTP/1.1\\r\\nHost: cert.test\\r\\nConnection: close\\r\\n\\r\\n" |& s; RS = "\\r\\n"; while ((s |& getline l) > 0) print "[" l "]"; close(s) }',
  );
  assert.equal(proxy.status, 0, `proxy rc=${proxy.status} stderr=${proxy.stderr}`);
  assert.match(proxy.stdout, /^\[HTTP\/1\.1 200 OK\]\n/);
  assert.match(proxy.stdout, /\[proxied \/awk\n\]/, `proxy: ${JSON.stringify(proxy.stdout)}`);

  // A tailnet name, resolved and dialled through the uplink.
  const tail = await aw(
    'BEGIN { s = "/inet/tcp/0/peer.tail1234.ts.net/8080"; printf "GET /t HTTP/1.1\\r\\nHost: peer\\r\\n\\r\\n" |& s; while ((s |& getline l) > 0) print l; close(s) }',
  );
  assert.equal(tail.status, 0, `tailnet rc=${tail.status} stderr=${tail.stderr}`);
  assert.equal(tail.stdout, 'HTTP/1.1 200 X\r\nContent-Length: 14\r\nConnection: close\r\n\r\nhello tailnet\n');
  const log = await ctx.uplinkLog();
  assert.deepEqual(log.dialled.at(-1), { host: '100.64.1.2', port: 8080 });
  assert.match(log.requests.at(-1).head, /^GET \/t HTTP\/1\.1\r\nHost: peer$/);

  // Refused, and an unknown name.
  const refused = await aw('BEGIN { s = "/inet/tcp/0/127.0.0.1/1"; print "x" |& s }');
  assert.equal(refused.status, 2, `refused rc=${refused.status}`);
  assert.match(refused.stderr, /cannot open two way pipe `\/inet\/tcp\/0\/127\.0\.0\.1\/1' for input\/output: Connection refused/);
  const unknown = await aw('BEGIN { s = "/inet/tcp/0/no.such.host.invalid/80"; print "x" |& s }');
  assert.equal(unknown.status, 2, `unknown rc=${unknown.status}`);
  assert.match(unknown.stderr, /\(no\.such\.host\.invalid, 80\) invalid: Name does not resolve/);
}
