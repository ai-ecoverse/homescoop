// Hashes, HMAC, AEADs, Fernet and the bundled OpenSSL, with the error paths:
// a bad tag, a bad HMAC, a bad Fernet token and bad PEM are Python
// exceptions (the target's std is panic=abort; none of these may abort).
const SCRIPT = String.raw`
import base64, json
import cryptography
from cryptography import exceptions
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.backends.openssl import backend
from cryptography.hazmat.primitives import hashes, hmac, serialization
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM, ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.bindings.openssl.binding import Binding
out = {"version": cryptography.__version__, "openssl": backend.openssl_version_text()}
def h(alg, data):
    d = hashes.Hash(alg); d.update(data); return d.finalize().hex()
out["sha256"] = h(hashes.SHA256(), b"abc")
out["sha512"] = h(hashes.SHA512(), b"abc")[:32]
out["sha3"] = h(hashes.SHA3_256(), b"abc")
out["blake2b"] = h(hashes.BLAKE2b(64), b"abc")[:32]
m = hmac.HMAC(b"key", hashes.SHA256()); m.update(b"The quick brown fox jumps over the lazy dog")
tag = m.finalize(); out["hmac"] = tag.hex()
m = hmac.HMAC(b"key", hashes.SHA256()); m.update(b"tampered")
try:
    m.verify(tag); out["hmac_bad"] = "accepted"
except exceptions.InvalidSignature:
    out["hmac_bad"] = "InvalidSignature"
key, nonce = bytes(range(32)), bytes(12)
g = AESGCM(key)
ct = g.encrypt(nonce, b"attack at dawn", b"aad")
out["aesgcm"] = [ct.hex(), g.decrypt(nonce, ct, b"aad").decode()]
try:
    g.decrypt(nonce, ct[:-1] + bytes([ct[-1] ^ 1]), b"aad"); out["aesgcm_bad"] = "accepted"
except exceptions.InvalidTag:
    out["aesgcm_bad"] = "InvalidTag"
c = ChaCha20Poly1305(key)
out["chacha"] = c.decrypt(nonce, c.encrypt(nonce, b"chacha", None), None).decode()
enc = Cipher(algorithms.AES(key), modes.CBC(bytes(16))).encryptor()
out["aescbc"] = (enc.update(bytes(32)) + enc.finalize()).hex()[:32]
out["pbkdf2"] = PBKDF2HMAC(hashes.SHA256(), 32, b"salt", 1000).derive(b"password").hex()
f = Fernet(base64.urlsafe_b64encode(bytes(range(32))))
out["fernet"] = f.decrypt(f.encrypt(b"secret")).decode()
try:
    Fernet(Fernet.generate_key()).decrypt(f.encrypt(b"x")); out["fernet_bad"] = "accepted"
except InvalidToken:
    out["fernet_bad"] = "InvalidToken"
try:
    serialization.load_pem_private_key(b"-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n", None); out["pem_bad"] = "accepted"
except ValueError as e:
    out["pem_bad"] = type(e).__name__
b = Binding()
out["cffi"] = [b.lib.OpenSSL_version_num() >> 20, b.ffi.string(b.lib.OpenSSL_version(0)).decode()]
print(json.dumps(out))
`;

export default async function (ctx) {
  const { run, write, assert } = ctx;
  await write('/tmp/crypto_primitives.py', SCRIPT);
  const r = await run(['python3', '/tmp/crypto_primitives.py'], { cwd: '/tmp' });
  assert.equal(r.status, 0, `rc=${r.status} stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const o = JSON.stringify(out);
  assert.equal(out.version, '50.0.2', o);
  assert.match(out.openssl, /^OpenSSL 3\.5\.9 /, o);
  assert.equal(out.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', o);
  assert.equal(out.sha512, 'ddaf35a193617abacc417349ae204131', o);
  assert.equal(out.sha3, '3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532', o);
  assert.equal(out.blake2b, 'ba80a53f981c4d0d6a2797b69f12f6e9', o);
  assert.equal(out.hmac, 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', o);
  assert.equal(out.hmac_bad, 'InvalidSignature', o);
  assert.equal(out.aesgcm[1], 'attack at dawn', o);
  assert.equal(out.aesgcm[0].length, (14 + 16) * 2, o);
  assert.equal(out.aesgcm_bad, 'InvalidTag', o);
  assert.equal(out.chacha, 'chacha', o);
  assert.equal(out.aescbc.length, 32, o);
  assert.equal(out.pbkdf2, '632c2812e46d4604102ba7618e9d6d7d2f8128f6266b4a03264d2a0460b7dcb3', o);
  assert.equal(out.fernet, 'secret', o);
  assert.equal(out.fernet_bad, 'InvalidToken', o);
  assert.equal(out.pem_bad, 'ValueError', o);
  assert.deepEqual(out.cffi, [0x305, out.openssl], o);
  console.log(`cryptography ${out.version} on ${out.openssl}: SHA-256/512, SHA3-256, BLAKE2b, HMAC, AES-GCM, ChaCha20-Poly1305, AES-CBC, PBKDF2 and Fernet give the known answers; a bad HMAC, AES-GCM tag, Fernet token and PEM raise InvalidSignature, InvalidTag, InvalidToken and ValueError; the cffi binding (pyOpenSSL's) calls OpenSSL_version`);
}
