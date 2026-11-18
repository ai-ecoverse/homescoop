// pyOpenSSL on py-cryptography's cffi binding: azure-cli's certificate
// login (auth/identity.py: load_certificate(FILETYPE_PEM) and
// digest("sha1") of the key+certificate PEM), X509/PKey conversions, and a
// whole TLS 1.3 handshake between two SSL.Connections over memory BIOs,
// which runs libssl through the binding end to end; a bad certificate and a
// failed verification are OpenSSL errors, not a trap.
const SCRIPT = String.raw`
import datetime, hashlib, json
import OpenSSL
from OpenSSL import SSL, crypto
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import NameOID
out = {"version": OpenSSL.__version__, "openssl": SSL.OpenSSL_version(SSL.OPENSSL_VERSION).decode()}
now = datetime.datetime.now(datetime.timezone.utc)
def make(cn, key, issuer=None, issuer_key=None, ca=False):
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    b = (x509.CertificateBuilder().subject_name(name).issuer_name(issuer.subject if issuer else name)
         .public_key(key.public_key()).serial_number(x509.random_serial_number())
         .not_valid_before(now - datetime.timedelta(days=1)).not_valid_after(now + datetime.timedelta(days=30))
         .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True))
    if not ca:
        b = b.add_extension(x509.SubjectAlternativeName([x509.DNSName(cn)]), critical=False)
    return b.sign(issuer_key or key, hashes.SHA256())
ca_key = ec.generate_private_key(ec.SECP256R1())
ca = make("pyopenssl test CA", ca_key, ca=True)
srv_key = rsa.generate_private_key(65537, 2048)
srv = make("server.test", srv_key, ca, ca_key)
# azure/cli/core/auth/identity.py, the certificate a service principal logs in with
pem = srv_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode() + srv.public_bytes(serialization.Encoding.PEM).decode()
cert = crypto.load_certificate(crypto.FILETYPE_PEM, pem)
thumb = cert.digest("sha1").decode().replace(":", "")
out["identity"] = [thumb == hashlib.sha1(srv.public_bytes(serialization.Encoding.DER)).hexdigest().upper(), cert.get_subject().CN, cert.get_issuer().CN, cert.has_expired()]
out["convert"] = [crypto.X509.from_cryptography(srv).to_cryptography() == srv, crypto.PKey.from_cryptography_key(srv_key).bits()]
try:
    crypto.load_certificate(crypto.FILETYPE_PEM, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"); out["bad"] = "accepted"
except crypto.Error:
    out["bad"] = "crypto.Error"
store = crypto.X509Store(); store.add_cert(crypto.X509.from_cryptography(ca))
crypto.X509StoreContext(store, cert).verify_certificate()
other = crypto.X509Store()
try:
    crypto.X509StoreContext(other, cert).verify_certificate(); out["unverified"] = "accepted"
except crypto.X509StoreContextError:
    out["unverified"] = "X509StoreContextError"
# TLS 1.3 over memory BIOs
sctx = SSL.Context(SSL.TLS_SERVER_METHOD)
sctx.use_certificate(crypto.X509.from_cryptography(srv)); sctx.use_privatekey(crypto.PKey.from_cryptography_key(srv_key)); sctx.check_privatekey()
cctx = SSL.Context(SSL.TLS_CLIENT_METHOD)
cctx.set_verify(SSL.VERIFY_PEER, lambda conn, c, errno, depth, ok: bool(ok))
cctx.get_cert_store().add_cert(crypto.X509.from_cryptography(ca))
s, c = SSL.Connection(sctx, None), SSL.Connection(cctx, None)
s.set_accept_state(); c.set_connect_state(); c.set_tlsext_host_name(b"server.test")
def pump():
    for a, b in ((c, s), (s, c)):
        try:
            while True:
                d = a.bio_read(65536)
                if not d: break
                b.bio_write(d)
        except SSL.WantReadError:
            pass
for _ in range(10):
    for conn in (c, s):
        try: conn.do_handshake()
        except SSL.WantReadError: pass
    pump()
c.send(b"hello over tls"); pump()
out["tls"] = [c.get_protocol_version_name(), s.recv(100).decode(), c.get_peer_certificate().get_subject().CN, c.get_cipher_name()]
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/pyopenssl_check.py', SCRIPT);
  const r = await run(['python3', '-W', 'ignore::DeprecationWarning', '/tmp/pyopenssl_check.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.version, '26.4.0', o);
  assert.match(out.openssl, /^OpenSSL 3\.5\.9 /, o);
  assert.deepEqual(out.identity, [true, 'server.test', 'pyopenssl test CA', false], o);
  assert.deepEqual(out.convert, [true, 2048], o);
  assert.equal(out.bad, 'crypto.Error', o);
  assert.equal(out.unverified, 'X509StoreContextError', o);
  assert.equal(out.tls[0], 'TLSv1.3', o);
  assert.equal(out.tls[1], 'hello over tls', o);
  assert.equal(out.tls[2], 'server.test', o);
  assert.match(out.tls[3], /^TLS_/, o);
  console.log(`pyOpenSSL ${out.version} on ${out.openssl}: az's load_certificate + digest("sha1") thumbprint of the key+certificate PEM is the DER's SHA-1; X509/PKey round-trip to cryptography; a store with the CA verifies the leaf and an empty one refuses it; ${out.tls[0]} handshake (${out.tls[3]}) between two SSL.Connections over memory BIOs with peer verification, and data across it`);
}
