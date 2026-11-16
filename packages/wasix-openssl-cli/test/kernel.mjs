// The openssl command on slicc-kernel's Node entry, in both of its runtimes:
// createNodeKernel() (process workers that block on shared memory) and
// createNodeKernel({ blocking: 'async', emscripten: 'kernel' }), the JSPI
// runtime a Cloudflare Durable Object runs, where a process has no second
// thread. Each mode boots two kernels: one with no network at all (what an
// agent's computer has today: offline commands, and s_client failing
// cleanly) and one whose uplink dials a TLS server on this machine (s_client
// through the normal socket and getaddrinfo path).
//
//   node packages/wasix-openssl-cli/test/kernel.mjs --tarball .homescoop-out/package.tgz \
//     [--kernel <spec or dir>] [--mode sync|async] [--only <name prefix>,…]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createSecureContext, createServer as createTlsServer } from 'node:tls';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ptySession } from '../../../scripts/browser-cert/context.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const meta = JSON.parse(readFileSync(join(here, '../cert/meta.json'), 'utf8'));
const argv = process.argv.slice(2);
const arg = (n) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const tarball = arg('--tarball');
assert.ok(tarball, 'usage: kernel.mjs --tarball <package.tgz> [--kernel <spec>] [--mode sync|async] [--only a,b]');
const only = arg('--only')?.split(',');
const modes = arg('--mode') ? [arg('--mode')] : ['sync', 'async'];
const MODE_OPTIONS = { sync: {}, async: { blocking: 'async', emscripten: 'kernel' } };
const ADDR = '93.184.216.34';
const NAME = 'tls.test';
const PKG = '/node_modules/@ai-ecoverse/wasix-openssl-cli';
const HOME = '/home/agent';

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const show = (r) => `rc=${r.status}\n--- stdout\n${(r.stdout ?? '').slice(-3000)}\n--- stderr\n${(r.stderr ?? '').slice(-3000)}`;

// An uplink like a tailnet's: tls.test resolves to ADDR, ADDR:443 is the
// host TLS server, ADDR:444 refuses, and nothing else is routed.
function uplink(tlsPort) {
  const dialled = [];
  return {
    dialled,
    traits: { tcp: true, udp: false, ipv6: false },
    routes: { prefixes: [`${ADDR}/32`], exit: false },
    resolve: async (name) => (name === NAME ? [ADDR] : []),
    dial: ({ host, port }) =>
      new Promise((ok, fail) => {
        dialled.push(`${host}:${port}`);
        if (host !== ADDR || port !== 443) return fail(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
        const s = connect(tlsPort, '127.0.0.1');
        const chunks = [];
        const waiters = [];
        let ended = false;
        const push = (v) => (waiters.length ? waiters.shift()(v) : chunks.push(v));
        s.on('data', (d) => push(new Uint8Array(d)));
        s.on('end', () => {
          ended = true;
          push(null);
        });
        s.on('error', (e) => {
          if (!ended) {
            ended = true;
            push(null);
          }
          fail(e);
        });
        s.once('connect', () =>
          ok({
            localAddr: { host: '100.100.100.100', port: s.localPort },
            remoteAddr: { host, port },
            read: () => (chunks.length ? Promise.resolve(chunks.shift()) : ended ? Promise.resolve(null) : new Promise((r) => waiters.push(r))),
            write: (bytes) => new Promise((r) => s.write(Buffer.from(bytes), () => r(bytes.length))),
            closeWrite: async () => {
              s.end();
            },
            close: async () => {
              s.destroy();
            },
          }),
        );
      }),
  };
}

const work = mkdtempSync(join(tmpdir(), 'wasix-openssl-cli-'));
const servers = [];
try {
  const pkg = join(work, 'pkg');
  mkdirSync(pkg);
  sh('tar', ['xzf', resolve(tarball), '-C', pkg]);
  const devKernel = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies['@ai-ecoverse/slicc-kernel'];
  const spec = arg('--kernel') ?? process.env.HOMESCOOP_CERT_KERNEL ?? meta.kernel ?? `@ai-ecoverse/slicc-kernel@${devKernel}`;
  const localKernel = existsSync(join(spec, 'dist/node.js'));
  const nm = join(work, 'nm');
  mkdirSync(nm);
  sh('npm', ['install', '--prefix', nm, '--no-fund', '--no-audit', '--silent', ...(localKernel ? [] : [spec]), ...meta.needsInstall]);
  const kroot = localKernel ? resolve(spec) : join(nm, 'node_modules/@ai-ecoverse/slicc-kernel');
  const kver = JSON.parse(readFileSync(join(kroot, 'package.json'), 'utf8')).version;
  const { createNodeKernel } = await import(pathToFileURL(join(kroot, 'dist/node.js')).href);
  const trees = [
    [join(pkg, 'package'), PKG],
    ...meta.needsInstall.map((need) => {
      const name = need.replace(/(.)@[^@]*$/, '$1');
      return [join(nm, 'node_modules', name), `/node_modules/${name}`];
    }),
  ];

  // Host TLS server for the uplink rows. Its key and certificate are made by
  // the package itself, in the first kernel, before the server starts.
  let material;
  const seen = [];
  let tlsServer;
  const startTlsServer = async () => {
    const ctx = createSecureContext({ key: material.leafKey, cert: material.leafPem });
    tlsServer = createTlsServer({
      SNICallback: (servername, cb) => {
        seen.push(servername);
        cb(null, ctx);
      },
    });
    tlsServer.on('secureConnection', (s) => {
      s.on('data', (d) => s.write(`echo:${d}`));
      s.on('error', () => {});
    });
    tlsServer.on('tlsClientError', () => {});
    await new Promise((r) => tlsServer.listen(0, '127.0.0.1', r));
    servers.push(tlsServer);
  };

  const boot = async (mode, network) => {
    const kernel = await createNodeKernel({ users: 'enforce', ...MODE_OPTIONS[mode], ...(network ? { network } : {}) });
    const copy = async (src, dest) => {
      for (const e of readdirSync(src)) {
        const p = join(src, e);
        if (statSync(p).isDirectory()) await copy(p, `${dest}/${e}`);
        else await kernel.writeFile(`${dest}/${e}`, readFileSync(p));
      }
    };
    for (const [src, dest] of trees) await copy(src, dest);
    await kernel.users.add({ name: 'agent' });
    const run = (script, o = {}) =>
      Promise.race([
        kernel.run(['bash', '-c', script], { cwd: HOME, user: 'agent', ...o }),
        new Promise((r) => setTimeout(() => r({ status: 'no exit within 60 s', stdout: '', stderr: '' }), 60000)),
      ]);
    for (let i = 0; ; i++) {
      const r = await run('openssl version');
      if (r.status === 0) break;
      if (i >= 50) assert.fail(`openssl version: ${show(r)}`);
      await new Promise((res) => setTimeout(res, 200));
    }
    const pty = (args, o = {}) => ptySession(kernel, args, { cwd: HOME, user: 'agent', timeoutMs: 30000, ...o });
    return { kernel, run, pty };
  };

  // Test material, made by the package: a CA, a leaf for localhost and
  // tls.test signed by it, a second CA that signed nothing.
  const PKI = `
set -e
mkdir -p pki && cd pki
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out ca.key
openssl req -new -x509 -key ca.key -subj '/O=homescoop/CN=throwaway test CA' -days 2 \\
  -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign -out ca.pem
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out leaf.key
openssl req -new -key leaf.key -subj /CN=${NAME} -out leaf.csr
printf 'subjectAltName=DNS:${NAME},DNS:localhost,IP:127.0.0.1\\nextendedKeyUsage=serverAuth\\n' > leaf.ext
openssl x509 -req -in leaf.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 2 -extfile leaf.ext -out leaf.pem
openssl req -new -x509 -newkey ed25519 -nodes -keyout other.key -subj '/CN=another CA' -days 2 -out other.pem 2>/dev/null
set +e
`;

  const offline = {
    async 'version -a: OpenSSL 3.5.9, the pinned build date, OPENSSLDIR /etc/ssl; list -disabled'({ run }) {
      const r = await run('openssl version -a; openssl list -providers');
      assert.equal(r.status, 0, show(r));
      assert.match(r.stdout, /^OpenSSL 3\.5\.9 29 Sep 2026 \(Library: OpenSSL 3\.5\.9 29 Sep 2026\)\n/, show(r));
      assert.match(r.stdout, /built on: Tue Sep 29 14:10:08 2026 UTC\n/);
      assert.match(r.stdout, /platform: linux-generic32\n/);
      assert.match(r.stdout, /OPENSSLDIR: "\/etc\/ssl"\n/);
      assert.match(r.stdout, /-DHAVE_FORK=0/);
      assert.match(r.stdout, /name: OpenSSL Default Provider\n\s+version: 3\.5\.9\n\s+status: active/);
      const c = await run('openssl list -disabled');
      assert.equal(c.status, 0, show(c));
      assert.match(c.stdout, /^Disabled algorithms:\nENGINE\n/, show(c));
      assert.doesNotMatch(c.stdout, /\n(SOCK|TLS1_3|EC|DTLS|OCSP|CMS)\n/, 'sockets, TLS 1.3, EC, DTLS, OCSP and CMS are in');
    },

    async 'genpkey, req -x509 and x509 -text -noout'({ run }) {
      const r = await run(`${PKI}
openssl x509 -in ca.pem -noout -text
openssl x509 -in leaf.pem -noout -text
openssl x509 -in leaf.pem -noout -subject -issuer -ext subjectAltName -fingerprint -sha256`);
      assert.equal(r.status, 0, show(r));
      assert.match(r.stdout, /Issuer: O=homescoop, CN=throwaway test CA\n/);
      assert.match(r.stdout, /Public Key Algorithm: id-ecPublicKey\n[\s\S]*NIST CURVE: P-256/);
      assert.match(r.stdout, /X509v3 Basic Constraints: critical\n\s+CA:TRUE/);
      assert.match(r.stdout, /Public-Key: \(2048 bit\)/);
      assert.match(r.stdout, /X509v3 Subject Alternative Name: \n\s+DNS:tls\.test, DNS:localhost, IP Address:127\.0\.0\.1/);
      assert.match(r.stdout, /Signature Algorithm: ecdsa-with-SHA256/);
      assert.match(r.stdout, /subject=CN=tls\.test\nissuer=O=homescoop, CN=throwaway test CA\n/);
      assert.match(r.stdout, /sha256 Fingerprint=([0-9A-F]{2}:){31}[0-9A-F]{2}\n/);
    },

    async 'verify against the CA; another CA and no CA fail'({ run }) {
      const r = await run(`${PKI}
openssl verify -CAfile ca.pem leaf.pem
openssl verify -CAfile ca.pem -verify_hostname ${NAME} -purpose sslserver leaf.pem
openssl verify -CAfile ca.pem -verify_hostname wrong.test leaf.pem; echo "rc=$?"
openssl verify -CAfile other.pem leaf.pem; echo "rc=$?"`);
      assert.equal(r.status, 0, show(r));
      assert.equal(r.stdout, 'leaf.pem: OK\nleaf.pem: OK\nrc=2\nrc=2\n', show(r));
      assert.match(r.stderr, /CN=tls\.test\nerror 62 at 0 depth lookup: hostname mismatch\nerror leaf\.pem: verification failed\n/, show(r));
      assert.match(r.stderr, /CN=tls\.test\nerror 20 at 0 depth lookup: unable to get local issuer certificate\nerror leaf\.pem: verification failed\n$/, show(r));
    },

    async 'asn1parse, pkey, req -text, dgst sign and verify, base64, enc, rand, pkcs12, storeutl, the legacy provider'({ run }) {
      const r = await run(`${PKI}
openssl asn1parse -in leaf.pem | head -5
openssl pkey -in ca.key -pubout -out ca.pub && openssl pkey -pubin -in ca.pub -noout -text | head -1
openssl req -in leaf.csr -noout -text | grep -E 'Subject:|Public-Key'
printf 'signed bytes' > msg
openssl dgst -sha256 -sign ca.key -out msg.sig msg && openssl dgst -sha256 -verify ca.pub -signature msg.sig msg
printf 'other bytes' > msg && { openssl dgst -sha256 -verify ca.pub -signature msg.sig msg; echo "tampered rc=$?"; }
printf 'abc' | openssl dgst -sha256 -r
printf 'abc' | openssl dgst -sha3-256
printf 'hello openssl\\n' | openssl base64 | tee b64
openssl base64 -d -in b64
printf 'secret text' | openssl enc -aes-256-cbc -pbkdf2 -pass pass:pw -out ct && openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:pw -in ct; echo
openssl rand -hex 16 | grep -cE '^[0-9a-f]{32}$'
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-384 -aes256 -pass pass:pw -out enc.key && head -1 enc.key && openssl pkey -in enc.key -passin pass:pw -noout -text | head -1
openssl genpkey -algorithm ML-DSA-65 -out mldsa.key && openssl pkey -in mldsa.key -noout -text | head -1
openssl x509 -in leaf.pem -outform DER -out leaf.der && openssl x509 -inform DER -in leaf.der -noout -subject
openssl pkcs12 -export -in leaf.pem -inkey leaf.key -certfile ca.pem -passout pass:pw -out leaf.p12 && openssl pkcs12 -in leaf.p12 -passin pass:pw -nokeys | grep -c 'BEGIN CERTIFICATE'
openssl storeutl -noout -certs leaf.pem
printf abc | openssl dgst -md4 -provider legacy -provider default`);
      assert.equal(r.status, 0, show(r));
      assert.match(r.stdout, /^ {4}0:d=0 {2}hl=4 l= *\d+ cons: SEQUENCE {10}\n/, show(r));
      assert.match(r.stdout, /Public-Key: \(256 bit\)\n/);
      assert.match(r.stdout, /Subject: CN=tls\.test\n\s+Public-Key: \(2048 bit\)/);
      assert.match(r.stdout, /Verified OK\nVerification failure\n[\s\S]*tampered rc=1\n/);
      assert.match(r.stdout, /ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad \*stdin\n/);
      assert.match(r.stdout, /SHA3-256\(stdin\)= 3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532\n/);
      assert.match(r.stdout, /aGVsbG8gb3BlbnNzbAo=\nhello openssl\n/);
      assert.match(r.stdout, /\nsecret text\n1\n/);
      assert.match(r.stdout, /-----BEGIN ENCRYPTED PRIVATE KEY-----\nPrivate-Key: \(384 bit\)\nML-DSA-65 Private-Key:\n/, show(r));
      assert.match(r.stdout, /subject=CN=tls\.test\n2\n0: Certificate\nTotal found: 1\nMD4\(stdin\)= a448017aaf21d8525fc10ae87aa6729d\n$/, show(r));
    },

    async 'the hashed root directory: SSL_CERT_DIR trusts Mozilla roots, every name is its subject hash'({ run }) {
      const r = await run(`
cd ${PKG}/etc/ssl/certs
n=0; bad=0
for f in *; do
  h=$(openssl x509 -in "$f" -noout -subject_hash) || bad=$((bad+1))
  [ "$h.\${f##*.}" = "$f" ] || [ "\${f%.*}" = "$h" ] || { echo "misnamed $f ($h)"; bad=$((bad+1)); }
  n=$((n+1))
done
echo "checked=$n bad=$bad"
grep -c 'BEGIN CERTIFICATE' ../cert.pem
first=$(ls | head -1)
openssl verify "$first" | sed "s#$first#ROOT#"
SSL_CERT_DIR=/nonexistent openssl verify "$first"; echo "rc=$?"`);
      assert.equal(r.status, 0, show(r));
      const m = /checked=(\d+) bad=0\n(\d+)\n/.exec(r.stdout);
      assert.ok(m, show(r));
      assert.equal(m[1], m[2], 'one file per certificate of cert.pem');
      assert.ok(Number(m[1]) > 100, show(r));
      assert.match(r.stdout, /\nROOT: OK\n/, "slicc.env's SSL_CERT_DIR names the package's directory, so a root verifies from it");
      assert.match(r.stderr, /error 18 at 0 depth lookup: self-signed certificate/, 'without the directory the same root is untrusted');
      assert.match(r.stdout, /rc=2\n$/);
    },

    async 'speed ends on its own (0001: the loops watch the clock)'({ run }) {
      const t = Date.now();
      const r = await run('openssl speed -seconds 1 -bytes 1024 sha256 2>&1; echo "rc=$?"');
      const ms = Date.now() - t;
      assert.match(r.stdout, /Doing sha256 ops for 1s on 1024 size blocks: \d+ sha256 ops in [\d.]+s\n[\s\S]*\nsha256 +[\d.]+k\n[\s\S]*rc=0\n$/, show(r));
      assert.ok(ms < 15000, `openssl speed -seconds 1 took ${ms} ms`);
      const e = await run('openssl speed -seconds 1 -elapsed ecdsap256 2>&1 | grep -E "^ *256 bits ecdsa \\(nistp256\\)"; echo "rc=$?"');
      assert.match(e.stdout, /256 bits ecdsa \(nistp256\) +[\d.]+s +[\d.]+s +[\d.]+ +[\d.]+\nrc=0\n$/, show(e));
    },

    async 's_server and s_client on the kernel loopback: TLS 1.3 and 1.2, the chain verifies, data both ways'({ run }) {
      const r = await run(`${PKI}
openssl s_server -accept 4433 -cert leaf.pem -key leaf.key -CAfile ca.pem -naccept 2 -rev > srv.out 2> srv.err &
for i in $(seq 100); do grep -q ACCEPT srv.out 2>/dev/null && break; sleep 0.1; done
(printf 'hello loopback\\n'; sleep 1) | openssl s_client -connect localhost:4433 -servername localhost -CAfile ca.pem -verify_return_error -showcerts > cli.out 2> cli.err
echo "client rc=$?"
(printf 'twelve\\n'; sleep 1) | openssl s_client -connect 127.0.0.1:4433 -tls1_2 -CAfile ca.pem -verify_return_error > cli12.out 2> cli12.err
echo "tls1.2 client rc=$?"
wait; echo "server rc=$?"
cat cli.out; echo ---; cat srv.out; echo ---; grep -E '^(New|evlewt)' cli12.out`);
      assert.match(r.stdout, /client rc=0\ntls1\.2 client rc=0\nserver rc=0\n/, `${show(r)}\n${r.stdout}`);
      assert.match(r.stdout, /---\nNew, TLSv1\.2, Cipher is ECDHE-RSA-AES256-GCM-SHA384\nevlewt\n$/, 'a TLS 1.2 client too');
      assert.match(r.stdout, /depth=1 O=homescoop, CN=throwaway test CA|Certificate chain\n 0 s:CN=tls\.test\n {3}i:O=homescoop, CN=throwaway test CA/, show(r));
      assert.match(r.stdout, /-----BEGIN CERTIFICATE-----/);
      assert.match(r.stdout, /Protocol: TLSv1\.3|New, TLSv1\.3, Cipher is TLS_AES_256_GCM_SHA384/);
      assert.match(r.stdout, /Verify return code: 0 \(ok\)/);
      assert.match(r.stdout, /kcabpool olleh/, 's_server -rev sent the line back reversed');
      assert.match(r.stdout, /\nACCEPT\n[\s\S]* 2 server accepts that finished\n/, 's_server accepted two connections and exited (-naccept 2)');
    },

    async 's_client -verify_return_error refuses a server the CA did not sign'({ run }) {
      const r = await run(`${PKI}
openssl s_server -accept 4434 -cert leaf.pem -key leaf.key -naccept 1 -quiet > srv.out 2>&1 &
sleep 1
openssl s_client -connect 127.0.0.1:4434 -CAfile other.pem -verify_return_error < /dev/null > cli.out 2>&1
echo "client rc=$?"
wait
grep -E 'verify error|Verify return code' cli.out`);
      assert.match(r.stdout, /client rc=1\n/, show(r));
      assert.match(r.stdout, /verify error:num=20:unable to get local issuer certificate/, show(r));
    },

    async 'a pass phrase typed on a terminal: the prompt, no echo, and the key opens with it'({ run, pty }) {
      const t = await pty(['openssl', 'genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-aes-256-cbc', '-out', 'typed.key'], {
        steps: [{ expect: 'Enter PEM pass phrase:' }, { write: 'sekrit\r' }, { expect: 'Verifying - Enter PEM pass phrase:' }, { write: 'sekrit\r' }],
      });
      assert.equal(t.status, 0, JSON.stringify(t));
      assert.doesNotMatch(t.out, /sekrit/, 'the terminal does not echo the pass phrase');
      const r = await run('openssl pkey -in typed.key -passin pass:sekrit -noout -text | head -1; openssl pkey -in typed.key -passin pass:wrong -noout; echo "rc=$?"');
      assert.match(r.stdout, /^Private-Key: \(256 bit\)\nrc=1\n$/, show(r));
    },

    async 's_client on a terminal, typing to s_server -www'({ run, pty }) {
      const srv = run(`${PKI}
openssl s_server -accept 4435 -cert leaf.pem -key leaf.key -www -naccept 1 > www.out 2>&1; echo "server rc=$?"`);
      await run('for i in $(seq 100); do grep -q ACCEPT pki/www.out 2>/dev/null && break; sleep 0.1; done');
      const t = await pty(['openssl', 's_client', '-connect', 'localhost:4435', '-CAfile', 'pki/ca.pem', '-quiet'], {
        steps: [{ expect: 'verify return:1\r\n' }, { write: 'GET / HTTP/1.0\r' }, { write: '\r', sleepMs: 200 }, { expect: 'Ciphers supported in s_server binary' }],
      });
      assert.equal(t.status, 0, JSON.stringify(t).slice(0, 3000));
      assert.match(t.out, /depth=1 O=homescoop, CN=throwaway test CA\r\nverify return:1\r\ndepth=0 CN=tls\.test\r\nverify return:1\r\n/, t.out.slice(0, 2000));
      assert.match(t.out, /HTTP\/1\.0 200 ok\r/);
      assert.match((await srv).stdout, /server rc=0\n$/);
    },

    async 'no route: s_client to an outer address is ENETUNREACH, an unknown name does not resolve, both at once'({ run }) {
      const t = Date.now();
      const a = await run(`openssl s_client -connect ${ADDR}:443 < /dev/null`);
      assert.equal(a.status, 1, show(a));
      assert.match(a.stderr, /BIO_connect:Network unreachable:crypto\/bio\/bio_sock2\.c:\d+:calling connect\(\)/, show(a));
      assert.match(a.stderr, /connect:errno=\d+\n$/);
      const b = await run('openssl s_client -connect example.com:443 -servername example.com < /dev/null');
      assert.equal(b.status, 1, show(b));
      assert.match(b.stderr, /BIO_lookup_ex:system lib:crypto\/bio\/bio_addr\.c:\d+:Name does not resolve/, show(b));
      assert.ok(Date.now() - t < 10000, `the two failures took ${Date.now() - t} ms`);
    },

    async 'memory: the largest jobs never grow the 16 MiB initial memory'({ run }) {
      // VmSize of each openssl process, polled from /proc while it runs. The
      // pid shows the forking bash's size before the exec and after the exit,
      // so readings equal to bash's own are left out (wasix-openssh's heap.mjs).
      const r = await run(`
b=; while read -r k v u; do [ "$k" = VmSize: ] && b=$v; done < /proc/$$/status
peak() { "$@" >/dev/null 2>&1 & p=$!; m=0; while kill -0 $p 2>/dev/null; do n=; while read -r k v u; do case $k in Name:) n=$v;; VmSize:) [ "$n" = openssl ] && [ "$v" != "$b" ] && [ "$v" -gt "$m" ] && m=$v;; esac; done < /proc/$p/status 2>/dev/null; done; wait $p; echo "$m kB rc=$? $*"; }
peak openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out rsa4096.key
peak openssl req -new -x509 -key rsa4096.key -subj /CN=big -days 1 -out big.pem
peak openssl x509 -in ${PKG}/etc/ssl/cert.pem -noout -text
peak openssl crl2pkcs7 -nocrl -certfile ${PKG}/etc/ssl/cert.pem -out bundle.p7
peak openssl pkcs7 -in bundle.p7 -print_certs -text -noout
head -c 4000000 /dev/urandom > blob && peak openssl dgst -sha512 blob
peak openssl speed -seconds 1 -bytes 16384 -evp aes-256-gcm`);
      assert.equal(r.status, 0, show(r));
      const rows = [...r.stdout.matchAll(/^(\d+) kB rc=(\d+) (.*)$/gm)];
      assert.equal(rows.length, 7, show(r));
      for (const [, kb, rc, cmd] of rows) {
        console.log(`   VmSize ${(kb / 1024).toFixed(1)} MiB: ${cmd}`);
        assert.equal(rc, '0', `${cmd}: rc ${rc}`);
        assert.equal(Number(kb), 16 * 1024, `${cmd}: VmSize ${kb} kB, so its memory grew past the 16 MiB it starts with`);
      }
    },
  };

  const online = {
    async 's_client through the uplink: getaddrinfo, connect, SNI, -showcerts, verify against the CA'({ run }, { dialled }) {
      const r = await run(`cd pki && printf 'ping\\n' | openssl s_client -connect ${NAME}:443 -servername ${NAME} -CAfile ca.pem -verify_return_error -showcerts -ign_eof 2>&1 & p=$!; sleep 3; kill $p 2>/dev/null; wait $p; true`);
      assert.match(r.stdout, /^Connecting to 93\.184\.216\.34\nCONNECTED\([0-9A-F]{8}\)\n/, show(r));
      assert.match(r.stdout, /depth=0 CN=tls\.test\nverify return:1\n/, show(r));
      assert.match(r.stdout, /Certificate chain\n 0 s:CN=tls\.test\n {3}i:O=homescoop, CN=throwaway test CA\n/);
      assert.match(r.stdout, /Verify return code: 0 \(ok\)/);
      assert.match(r.stdout, /echo:ping/, 'the bytes went through the uplink and back');
      assert.ok(dialled.includes(`${ADDR}:443`), `dialled ${dialled}`);
      assert.ok(seen.includes(NAME), `SNI ${NAME} reached the server: ${seen}`);
    },

    async 'through the uplink: a refused port, an unrouted address and an unknown name fail cleanly'({ run }) {
      const a = await run(`openssl s_client -connect ${NAME}:444 < /dev/null`);
      assert.equal(a.status, 1, show(a));
      assert.match(a.stderr, /BIO_connect:Connection refused/, show(a));
      const b = await run('openssl s_client -connect 198.51.100.7:443 < /dev/null');
      assert.equal(b.status, 1, show(b));
      assert.match(b.stderr, /BIO_connect:Network unreachable/, show(b));
      const c = await run('openssl s_client -connect nothere.test:443 < /dev/null');
      assert.equal(c.status, 1, show(c));
      assert.match(c.stderr, /Name does not resolve/, show(c));
    },
  };

  const pick = (cases) => Object.entries(cases).filter(([n]) => !only || only.some((o) => n.startsWith(o)));
  let passed = 0;
  for (const mode of modes) {
    const label = `slicc-kernel ${kver}, ${mode === 'sync' ? 'createNodeKernel()' : "createNodeKernel({ blocking: 'async', emscripten: 'kernel' })"}`;
    console.log(`== ${label}`);
    const k = await boot(mode);
    try {
      for (const [n, fn] of pick(offline)) {
        const t = Date.now();
        try {
          await fn(k);
        } catch (err) {
          err.message = `${label}: ${n}: ${err.message}`;
          throw err;
        }
        passed++;
        console.log(`ok ${n} (${Date.now() - t} ms)`);
      }
      if (!material) {
        const r = await k.run(PKI);
        assert.equal(r.status, 0, show(r));
        const read = async (f) => Buffer.from(await k.kernel.readFile(`${HOME}/pki/${f}`));
        material = { caPem: await read('ca.pem'), leafKey: await read('leaf.key'), leafPem: await read('leaf.pem') };
        await startTlsServer();
      }
    } finally {
      k.kernel.terminate();
    }
    const up = uplink(tlsServer.address().port);
    const k2 = await boot(mode, { uplink: up });
    try {
      // The host server's certificate is signed by the first kernel's CA.
      await k2.kernel.writeFile(`${HOME}/pki/ca.pem`, material.caPem);
      for (const [n, fn] of pick(online)) {
        const t = Date.now();
        try {
          await fn(k2, up);
        } catch (err) {
          err.message = `${label}, uplink: ${n}: ${err.message}`;
          throw err;
        }
        passed++;
        console.log(`ok ${n} (${Date.now() - t} ms)`);
      }
    } finally {
      k2.kernel.terminate();
    }
  }
  assert.ok(passed > 0, `--only ${only} matched no case`);
  console.log(`wasix-openssl-cli: ${passed} cases passed on slicc-kernel ${kver}`);
} finally {
  for (const s of servers) s.close();
  rmSync(work, { recursive: true, force: true });
}
