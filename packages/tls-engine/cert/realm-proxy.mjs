/**
 * The engine where SLICC uses it: the kernel's realm proxy terminates curl's
 * CONNECT tunnels with this package (the tarball under test is the only
 * @ai-ecoverse/wasm-tls-engine installed), presenting a leaf the kernel CA
 * signed for the engine's key. curl's own Mbed TLS client does the other
 * side; ctx.serve() is the far end. TLS 1.3 and TLS 1.2, a download and an
 * upload larger than the engine's buffers (64 KiB out, 40 KiB in), two
 * requests on one tunnel, and a CA that did not sign the leaf (rc 60).
 */
import { createHash } from 'node:crypto';

// A self-signed CA that signed nothing (packages/curl/cert/checklist.mjs).
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
`;

const BIG = 300_000;
const blob = () => {
  const b = new Uint8Array(BIG);
  for (let i = 0; i < b.length; i++) b[i] = (i * 31 + (i >> 8) * 7 + 7) & 255;
  return b;
};
// ASCII, so ctx.run's stdin carries it unchanged.
const upload = () => Array.from({ length: 4000 }, (_, i) => `line ${i} of the upload ${'x'.repeat(i % 37)}\n`).join('');

// Runs in the page: self-contained.
async function responder(req) {
  const u = new URL(req.url);
  if (u.pathname === '/hello') {
    return { headers: [['content-type', 'text/plain']], body: `hello ${u.protocol} ${req.method} ${u.host}\n` };
  }
  if (u.pathname === '/blob.bin') {
    const b = new Uint8Array(300_000);
    for (let i = 0; i < b.length; i++) b[i] = (i * 31 + (i >> 8) * 7 + 7) & 255;
    return { headers: [['content-type', 'application/octet-stream']], body: b };
  }
  if (u.pathname === '/sha256') {
    const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', req.body));
    const hex = Array.from(sum, (b) => b.toString(16).padStart(2, '0')).join('');
    return { headers: [['content-type', 'text/plain']], body: `${req.method} ${req.body.length} ${hex}\n` };
  }
  return { status: 404, statusText: 'Not Found', body: 'nope\n' };
}

export default async function (ctx) {
  const { run, serve, assert } = ctx;
  const cwd = '/home/tls';
  const ok = async (argv, opts = {}) => {
    const r = await run(argv, { cwd, ...opts });
    assert.equal(r.status, 0, `${argv.join(' ')}: rc=${r.status} stderr=${r.stderr}`);
    return r;
  };
  await serve(responder);
  assert.equal((await run(['mkdir', '-p', cwd])).status, 0);

  const versions = [
    ['TLSv1.3', ['--tlsv1.3']],
    ['TLSv1.2', ['--tlsv1.2', '--tls-max', '1.2']],
  ];
  for (const [name, pin] of versions) {
    // Handshake and round trip: curl verifies the engine's chain against
    // the kernel CA and names the negotiated version.
    const hello = await ok(['curl', '-sS', '-v', ...pin, 'https://cert.test/hello']);
    assert.equal(hello.stdout, 'hello https: GET cert.test\n', `${name}: body`);
    assert.match(hello.stderr, new RegExp(`mbedTLS: ${name.replace('.', '\\.')} Handshake complete`), `${name}: version`);
    assert.match(hello.stderr, /subject name\s*: CN=cert\.test/, `${name}: leaf subject`);
    assert.match(hello.stderr, /issuer name\s*: O=SLICC, CN=SLICC realm CA /, `${name}: kernel CA`);
    assert.match(hello.stderr, /EC key size\s*: 256 bits/, `${name}: the engine's P-256 key`);

    // 300 000 bytes down: many records, more than the engine's 64 KiB out buffer.
    await ok(['curl', '-sS', ...pin, '-o', `blob-${name}.bin`, 'https://cert.test/blob.bin']);
    const want = createHash('sha256').update(blob()).digest('hex');
    assert.equal((await ok(['sha256sum', `blob-${name}.bin`])).stdout, `${want}  blob-${name}.bin\n`, `${name}: download corrupted`);

    // Up: a body larger than the engine's 40 KiB in buffer, hashed by the far end.
    const body = upload();
    await ok(['tee', 'up.txt'], { stdin: body });
    const up = await ok(['curl', '-sS', ...pin, '--data-binary', '@up.txt', 'https://cert.test/sha256']);
    const sum = createHash('sha256').update(body).digest('hex');
    assert.equal(up.stdout, `POST ${body.length} ${sum}\n`, `${name}: upload corrupted`);
  }

  // Two requests on one tunnel (keep-alive through the engine).
  const two = await ok(['curl', '-sS', '-v', 'https://cert.test/hello', 'https://cert.test/hello']);
  assert.equal(two.stdout, 'hello https: GET cert.test\n'.repeat(2));
  assert.match(two.stderr, /Re-using existing|left intact/i);

  // A client that does not trust the kernel CA refuses the engine's chain
  // (60); -k with the same CA file goes through, so the failure is the chain.
  await ok(['tee', 'decoy.pem'], { stdin: DECOY_CA });
  const bad = await run(['curl', '-sS', '--cacert', 'decoy.pem', 'https://cert.test/hello'], { cwd });
  assert.equal(bad.status, 60, `untrusted CA rc=${bad.status} stderr=${bad.stderr}`);
  assert.equal(bad.stdout, '');
  assert.equal(
    (await ok(['curl', '-sS', '-k', '--cacert', 'decoy.pem', 'https://cert.test/hello'])).stdout,
    'hello https: GET cert.test\n',
  );
}
