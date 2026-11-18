// pyo3 keeps per-thread state (thread_local!) in the side module's TLS,
// which slicc-kernel sets up for each new thread (__wasix_init_tls). Python
// threads hash, sign and verify at once; and python's own OpenSSL (ssl,
// hashlib) works next to _rust's copy in the same process.
const SCRIPT = String.raw`
import hashlib, json, ssl, threading
from cryptography.hazmat.backends.openssl import backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ed25519
results, errors = [], []
def work(i):
    try:
        for n in range(50):
            d = hashes.Hash(hashes.SHA256()); d.update(b"%d-%d" % (i, n)); h = d.finalize()
            assert h == hashlib.sha256(b"%d-%d" % (i, n)).digest()
            k = ed25519.Ed25519PrivateKey.generate(); k.public_key().verify(k.sign(h), h)
        results.append(i)
    except Exception as e:
        errors.append(repr(e))
ts = [threading.Thread(target=work, args=(i,)) for i in range(4)]
[t.start() for t in ts]
[t.join() for t in ts]
ctx = ssl.create_default_context()
print(json.dumps({"threads": sorted(results), "errors": errors, "python_ssl": ssl.OPENSSL_VERSION, "cryptography": backend.openssl_version_text(), "ssl_ctx": ctx.verify_mode == ssl.CERT_REQUIRED}))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/crypto_threads.py', SCRIPT);
  const r = await run(['python3', '/tmp/crypto_threads.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.deepEqual(out.threads, [0, 1, 2, 3], o);
  assert.deepEqual(out.errors, [], o);
  assert.match(out.python_ssl, /^OpenSSL 3\.5\.9 /, o);
  assert.equal(out.cryptography, out.python_ssl, `python.wasm's OpenSSL and _rust's are the same release: ${o}`);
  assert.equal(out.ssl_ctx, true, o);
  console.log(`threads: 4 Python threads each hash 50 times (equal to hashlib's) and sign and verify with Ed25519 at once; python's ssl (${out.python_ssl}) makes a default context next to _rust's own copy of the same OpenSSL`);
}
