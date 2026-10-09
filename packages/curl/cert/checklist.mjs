/**
 * curl checklist (homescoop#123, PR #127): http and https through the
 * kernel's realm proxy, -o/-O, -I/-i, -L and --max-redirs, -d/-H/-X,
 * --fail exit codes, --compressed (zlib), a binary download by sha256,
 * and TLS verification failures. ctx.serve() installs the far end: the
 * kernel's proxy, its TLS termination (kernel CA, wasm-tls-engine) and
 * curl's own Mbed TLS handshake are real; only the server is the spec's.
 */
import { createHash } from 'node:crypto';

// A self-signed CA that signed nothing, so verification against it fails.
const DECOY_CA = `-----BEGIN CERTIFICATE-----
MIIBejCCASCgAwIBAgIUVTMLtKUXhLNhIhmQiIQ8WMhSLNwwCgYIKoZIzj0EAwIw
IjEgMB4GA1UEAwwXaG9tZXNjb29wIGNlcnQgZGVjb3kgQ0EwIBcNMjYxMDA5MTcw
OTM3WhgPMjEyNjA5MTUxNzA5MzdaMCIxIDAeBgNVBAMMF2hvbWVzY29vcCBjZXJ0
IGRlY295IENBMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE/TMSJELEOITBRPuB
cmBf4meqXUgzoCELxJOs3hlV1QJHijgmPmrut4eak18G7RdYdY4mFKLGkjVVUrjy
R5LWaqMyMDAwHQYDVR0OBBYEFP0MmyVlQ8xDflSyX1HrBR56yoZCMA8GA1UdEwEB
/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIhAPgov50uSXyN4V+xve6j+J4Vj0Jm
2kTV6HVbVm4c1XnCAiA7+Rd3tWEZR14eORFRylER2Q7RXS2nywUx+ePgmISgrg==
-----END CERTIFICATE-----
-----END CERTIFICATE-----
`;

const blob = () => {
  const b = new Uint8Array(70000);
  for (let i = 0; i < b.length; i++) b[i] = (i * 31 + (i >> 8) * 7 + 7) & 255;
  return b;
};

// Runs in the page (or the Node kernel's transport): self-contained.
async function responder(req) {
  const u = new URL(req.url);
  const td = new TextDecoder();
  const hdr = (n) => (req.headers.find(([k]) => k.toLowerCase() === n) || [])[1] || '';
  const p = u.pathname;
  if (p === '/hello') {
    return { headers: [['content-type', 'text/plain'], ['x-cert', 'yes']], body: `hello ${u.protocol} ${req.method}\n` };
  }
  if (p === '/echo') {
    const body = JSON.stringify({
      method: req.method,
      ct: hdr('content-type'),
      ua: hdr('user-agent').split('/')[0],
      xh: hdr('x-homescoop'),
      body: td.decode(req.body),
      host: u.host,
      query: u.search,
    });
    return { headers: [['content-type', 'application/json']], body: `${body}\n` };
  }
  if (p.startsWith('/redirect/')) {
    const n = Number(p.split('/')[2]);
    return { status: 302, statusText: 'Found', headers: [['location', n > 0 ? `/redirect/${n - 1}` : '/hello']], body: '' };
  }
  if (p.startsWith('/status/')) {
    const c = Number(p.split('/')[2]);
    return { status: c, statusText: 'Cert', headers: [['content-type', 'text/plain']], body: `status ${c}\n` };
  }
  if (p === '/blob.bin') {
    const b = new Uint8Array(70000);
    for (let i = 0; i < b.length; i++) b[i] = (i * 31 + (i >> 8) * 7 + 7) & 255;
    return { headers: [['content-type', 'application/octet-stream']], body: b };
  }
  if (p === '/gz') {
    const raw = atob('H4sIAAAAAAACE0vOzy0oSi0uTk1RyEjNyclXSCvKz1WoyslM4gIA63sD6BsAAAA=');
    const b = Uint8Array.from(raw, (c) => c.charCodeAt(0));
    return { headers: [['content-type', 'text/plain'], ['content-encoding', 'gzip']], body: b };
  }
  return { status: 404, statusText: 'Not Found', body: 'nope\n' };
}

export default async function (ctx) {
  const { run, serve, assert } = ctx;
  const cwd = '/home/curl';
  const go = (argv) => run(argv, { cwd });
  const ok = async (argv) => {
    const r = await go(argv);
    assert.equal(r.status, 0, `${argv.join(' ')}: rc=${r.status} stderr=${r.stderr}`);
    return r;
  };
  await serve(responder);
  const mk = await run(['mkdir', '-p', cwd], { cwd: '/home' });
  assert.equal(mk.status, 0, `mkdir stderr=${mk.stderr}`);

  const ver = await ok(['curl', '--version']);
  assert.match(ver.stdout, /^curl 8\.22\.0 .* mbedTLS\/3\.6\.5 zlib\/1\.3\.1$/m);
  assert.match(ver.stdout, /^Protocols: .*\bhttps\b/m);

  // http (absolute-form through the proxy) and https (CONNECT, TLS).
  assert.equal((await ok(['curl', '-sS', 'http://cert.test/hello'])).stdout, 'hello http: GET\n');
  assert.equal((await ok(['curl', '-sS', 'https://cert.test/hello'])).stdout, 'hello https: GET\n');

  // -o / -O.
  await ok(['curl', '-sS', '-o', 'out.txt', 'https://cert.test/hello']);
  assert.equal((await ok(['cat', 'out.txt'])).stdout, 'hello https: GET\n');
  await ok(['curl', '-sS', '-O', 'https://cert.test/blob.bin']);
  const sum = await ok(['sha256sum', 'blob.bin']);
  const want = createHash('sha256').update(blob()).digest('hex');
  assert.equal(sum.stdout, `${want}  blob.bin\n`, 'binary download corrupted');

  // -I (HEAD) and -i.
  const head = await ok(['curl', '-sS', '-I', 'http://cert.test/hello']);
  assert.match(head.stdout, /^HTTP\/1\.1 200 OK\r$/m);
  assert.match(head.stdout, /^x-cert: yes\r$/m);
  assert.doesNotMatch(head.stdout, /hello/, '-I printed a body');
  const echoHead = await ok(['curl', '-sS', '-I', 'https://cert.test/echo']);
  assert.match(echoHead.stdout, /^content-type: application\/json\r$/m);
  const inc = await ok(['curl', '-sS', '-i', 'https://cert.test/redirect/2']);
  assert.match(inc.stdout, /^HTTP\/1\.1 302 Found\r$/m);
  assert.match(inc.stdout, /^location: \/redirect\/1\r$/m);

  // -L follows a redirect chain; --max-redirs stops it (47).
  assert.equal((await ok(['curl', '-sS', '-L', 'https://cert.test/redirect/3'])).stdout, 'hello https: GET\n');
  const eff = await ok(['curl', '-sS', '-L', '-o', '/dev/null', '-w', '%{http_code} %{num_redirects} %{url_effective}', 'http://cert.test/redirect/2']);
  assert.equal(eff.stdout, '200 3 http://cert.test/hello');
  const maxr = await go(['curl', '-sS', '-L', '--max-redirs', '1', 'https://cert.test/redirect/3']);
  assert.equal(maxr.status, 47, `--max-redirs rc=${maxr.status}`);
  assert.match(maxr.stderr, /Maximum \(1\) redirects followed/);

  // -d POST, -H, -X, query strings.
  const post = JSON.parse((await ok(['curl', '-sS', '-d', 'a=1&b=two', 'https://cert.test/echo'])).stdout);
  assert.deepEqual(
    [post.method, post.ct, post.body, post.host],
    ['POST', 'application/x-www-form-urlencoded', 'a=1&b=two', 'cert.test'],
  );
  const json = JSON.parse(
    (await ok(['curl', '-sS', '-X', 'PUT', '-H', 'Content-Type: application/json', '-H', 'X-Homescoop: 123',
      '--data-binary', '{"k":[1,2]}', 'http://cert.test/echo?x=1&y=%20'])).stdout,
  );
  assert.deepEqual(
    [json.method, json.ct, json.xh, json.body, json.query, json.ua],
    ['PUT', 'application/json', '123', '{"k":[1,2]}', '?x=1&y=%20', 'curl'],
  );

  // --fail: 22 on 4xx/5xx; without it the body comes through, rc 0.
  for (const code of [404, 500]) {
    const f = await go(['curl', '-sS', '--fail', `https://cert.test/status/${code}`]);
    assert.equal(f.status, 22, `--fail ${code} rc=${f.status}`);
    assert.match(f.stderr, new RegExp(`returned error: ${code}`));
    assert.equal(f.stdout, '');
  }
  const nofail = await ok(['curl', '-sS', '-w', '%{http_code}', 'https://cert.test/status/404']);
  assert.equal(nofail.stdout, 'status 404\n404');

  // --compressed: gzip decoded by curl's zlib.
  assert.equal((await ok(['curl', '-sS', '--compressed', 'https://cert.test/gz'])).stdout, 'compressed hello from zlib\n');

  // TLS: a CA that did not sign the kernel's certificate fails
  // verification (60); -k accepts it; an unreadable CA file is 77.
  const w = await run(['bash', '-c', 'cat > decoy.pem'], { cwd, stdin: DECOY_CA });
  assert.equal(w.status, 0);
  const bad = await go(['curl', '-sS', '--cacert', 'decoy.pem', 'https://cert.test/hello']);
  assert.equal(bad.status, 60, `untrusted CA rc=${bad.status} stderr=${bad.stderr}`);
  assert.match(bad.stderr, /SSL certificate|certificate verify|verify/i);
  assert.equal(bad.stdout, '');
  assert.equal((await ok(['curl', '-sS', '-k', '--cacert', 'decoy.pem', 'https://cert.test/hello'])).stdout, 'hello https: GET\n');
  await ok(['bash', '-c', 'printf "not a certificate\\n" > junk.pem']);
  const junk = await go(['curl', '-sS', '--cacert', 'junk.pem', 'https://cert.test/hello']);
  assert.equal(junk.status, 77, `junk CA rc=${junk.status} stderr=${junk.stderr}`);

  // Local errors.
  const badUrl = await go(['curl', '-sS', 'htp://cert.test/']);
  assert.equal(badUrl.status, 1, `unsupported protocol rc=${badUrl.status}`);
  const noDir = await go(['curl', '-sS', '-o', 'no/such/dir/x', 'https://cert.test/hello']);
  assert.equal(noDir.status, 23, `write error rc=${noDir.status}`);
}
