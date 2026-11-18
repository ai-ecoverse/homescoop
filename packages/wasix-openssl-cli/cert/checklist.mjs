/**
 * wasix-openssl-cli checklist, in the cert page's kernel (Chromium, users
 * enforce, no uplink): the offline commands, s_server and s_client on the
 * kernel's loopback, and s_client failing cleanly where nothing routes.
 * test/kernel.mjs (the ci command) runs the same and more on the Node entry
 * in both runtimes, with an uplink.
 */
export default async function (ctx) {
  const { run, pty, assert, addUser } = ctx;
  const PKG = '/node_modules/@ai-ecoverse/wasix-openssl-cli';
  const HOME = '/home/certossl';
  await addUser({ name: 'certossl' });
  const sh = (script) => run(['bash', '-c', script], { cwd: HOME, user: 'certossl' });
  const show = (r) => `rc=${r.status}\n--- stdout\n${(r.stdout ?? r.out ?? '').slice(-3000)}\n--- stderr\n${(r.stderr ?? '').slice(-3000)}`;
  const PKI = `
set -e
mkdir -p pki && cd pki
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out ca.key
openssl req -new -x509 -key ca.key -subj '/O=homescoop/CN=throwaway test CA' -days 2 \\
  -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign -out ca.pem
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out leaf.key 2>/dev/null
openssl req -new -key leaf.key -subj /CN=localhost -out leaf.csr
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\\nextendedKeyUsage=serverAuth\\n' > leaf.ext
openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 -extfile leaf.ext -out leaf.pem 2>/dev/null
openssl req -new -x509 -newkey ed25519 -nodes -keyout other.key -subj '/CN=another CA' -days 2 -out other.pem 2>/dev/null
set +e
`;

  const v = await sh('openssl version -a');
  assert.equal(v.status, 0, show(v));
  assert.match(v.stdout, /^OpenSSL 3\.5\.9 29 Sep 2026 \(Library: OpenSSL 3\.5\.9 29 Sep 2026\)\nbuilt on: Tue Sep 29 14:10:08 2026 UTC\nplatform: linux-generic32\n/, show(v));
  assert.match(v.stdout, /OPENSSLDIR: "\/etc\/ssl"\n/);

  const x = await sh(`${PKI}
openssl x509 -in leaf.pem -noout -text
openssl verify -CAfile ca.pem -verify_hostname localhost leaf.pem
openssl verify -CAfile other.pem leaf.pem; echo "rc=$?"
openssl asn1parse -in ca.pem | head -2
printf abc | openssl dgst -sha256
printf 'hello\\n' | openssl base64`);
  assert.equal(x.status, 0, show(x));
  assert.match(x.stdout, /Issuer: O=homescoop, CN=throwaway test CA\n/, show(x));
  assert.match(x.stdout, /Public-Key: \(2048 bit\)/);
  assert.match(x.stdout, /X509v3 Subject Alternative Name: \n\s+DNS:localhost, IP Address:127\.0\.0\.1\n/);
  assert.match(x.stdout, /\nleaf\.pem: OK\nrc=2\n/);
  assert.match(x.stderr, /error 20 at 0 depth lookup: unable to get local issuer certificate/);
  assert.match(x.stdout, / {4}0:d=0 {2}hl=\d l= *\d+ cons: SEQUENCE {10}\n/);
  assert.match(x.stdout, /SHA2-256\(stdin\)= ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\naGVsbG8K\n$/);

  const roots = await sh(`first=$(ls ${PKG}/etc/ssl/certs | head -1); openssl verify ${PKG}/etc/ssl/certs/$first | sed "s#.*/##"; ls ${PKG}/etc/ssl/certs | wc -l`);
  assert.equal(roots.status, 0, show(roots));
  assert.match(roots.stdout, /^[0-9a-f]{8}\.0: OK\n\s*1\d\d\n$/, `a Mozilla root verifies from SSL_CERT_DIR: ${show(roots)}`);

  const tls = await sh(`${PKI}
openssl s_server -accept 4433 -cert leaf.pem -key leaf.key -naccept 1 -rev > srv.out 2> srv.err &
for i in $(seq 100); do grep -q ACCEPT srv.out 2>/dev/null && break; sleep 0.1; done
(printf 'hello loopback\\n'; sleep 1) | openssl s_client -connect localhost:4433 -servername localhost -CAfile ca.pem -verify_return_error > cli.out 2> cli.err
echo "client rc=$?"
wait; echo "server rc=$?"
grep -E '^(Verify return code|New, |kcab)' cli.out | sort -u`);
  assert.match(tls.stdout, /client rc=0\nserver rc=0\n/, show(tls));
  assert.match(tls.stdout, /New, TLSv1\.3, Cipher is TLS_AES_256_GCM_SHA384\n/, show(tls));
  assert.match(tls.stdout, /Verify return code: 0 \(ok\)\n/);
  assert.match(tls.stdout, /kcabpool olleh\n/, 's_server -rev sent the line back reversed');

  const bad = await sh(`cd pki
openssl s_server -accept 4434 -cert leaf.pem -key leaf.key -naccept 1 -quiet > /dev/null 2>&1 &
sleep 1
openssl s_client -connect 127.0.0.1:4434 -CAfile other.pem -verify_return_error < /dev/null 2>&1 | grep -E '^verify error'; wait`);
  assert.match(bad.stdout, /verify error:num=20:unable to get local issuer certificate/, show(bad));

  const t0 = Date.now();
  const net = await sh('openssl s_client -connect 93.184.216.34:443 < /dev/null; echo "rc=$?"; openssl s_client -connect example.com:443 < /dev/null; echo "rc=$?"');
  assert.equal(net.stdout, 'rc=1\nrc=1\n', show(net));
  assert.match(net.stderr, /BIO_connect:Network unreachable:crypto\/bio\/bio_sock2\.c:\d+:calling connect\(\)/, show(net));
  assert.match(net.stderr, /BIO_lookup_ex:system lib:crypto\/bio\/bio_addr\.c:\d+:Name does not resolve/, show(net));
  assert.ok(Date.now() - t0 < 15000, `the network failures took ${Date.now() - t0} ms`);

  const t1 = Date.now();
  const speed = await sh('openssl speed -seconds 1 -bytes 1024 sha256 2>&1; echo "rc=$?"');
  assert.match(speed.stdout, /Doing sha256 ops for 1s on 1024 size blocks: \d+ sha256 ops in [\d.]+s\n[\s\S]*rc=0\n$/, show(speed));
  assert.ok(Date.now() - t1 < 20000, `speed -seconds 1 took ${Date.now() - t1} ms (0001)`);

  const term = await pty(['openssl', 'genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-aes-256-cbc', '-out', 'typed.key'], {
    cwd: HOME,
    user: 'certossl',
    timeoutMs: 30000,
    steps: [{ expect: 'Enter PEM pass phrase:' }, { write: 'sekrit\r' }, { expect: 'Verifying - Enter PEM pass phrase:' }, { write: 'sekrit\r' }],
  });
  assert.equal(term.status, 0, show(term));
  assert.doesNotMatch(term.out, /sekrit/);
  const opened = await sh('openssl pkey -in typed.key -passin pass:sekrit -noout -text | head -1');
  assert.equal(opened.stdout, 'Private-Key: (256 bit)\n', show(opened));
  console.log('wasix-openssl-cli checklist: version -a, a CA and leaf with x509 -text and verify, a Mozilla root from SSL_CERT_DIR, s_server/s_client on loopback, a refused chain, ENETUNREACH and an unknown name, speed ends, a typed pass phrase');
}
