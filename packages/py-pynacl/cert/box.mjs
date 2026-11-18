// Box (Curve25519-XSalsa20-Poly1305) and SecretBox known answers, from a
// native libsodium, plus Aead (XChaCha20-Poly1305) and the RFC 8439 vector.
import { readFileSync } from 'node:fs';
import { py } from '../test/cert-py.mjs';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const SCRIPT = String.raw`
import json, sys
import nacl.bindings as b
import nacl.exceptions
from nacl import public, secret, utils
v = json.loads(sys.argv[1])
h = bytes.fromhex
alice = public.PrivateKey(h("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"))
bob = public.PrivateKey(h("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb"))
msg, nonce, key = b"homescoop wasix-libsodium known answer", bytes(range(24)), bytes(range(32))
out = {"alice_pk": alice.public_key.encode().hex()}
ab = public.Box(alice, bob.public_key)
out["shared"] = ab.shared_key().hex()
c = ab.encrypt(msg, nonce)
out["box"] = c.ciphertext.hex()
out["box_nonce"] = c.nonce == nonce
out["box_open"] = public.Box(bob, alice.public_key).decrypt(c).decode()
t = bytearray(c); t[-1] ^= 1
try:
    public.Box(bob, alice.public_key).decrypt(bytes(t)); out["box_tampered"] = "opened"
except nacl.exceptions.CryptoError as e:
    out["box_tampered"] = type(e).__name__
sb = secret.SecretBox(key)
c = sb.encrypt(msg, nonce)
out["secretbox"] = c.ciphertext.hex()
out["secretbox_open"] = sb.decrypt(c).decode()
r = sb.encrypt(msg)
out["secretbox_random_nonce"] = len(r.nonce) == 24 and sb.decrypt(r) == msg
try:
    secret.SecretBox(bytes(32)).decrypt(c); out["secretbox_wrong_key"] = "opened"
except nacl.exceptions.CryptoError as e:
    out["secretbox_wrong_key"] = type(e).__name__
ae = secret.Aead(key)
c = ae.encrypt(msg, b"ad")
out["aead_xchacha"] = ae.decrypt(c, b"ad") == msg
try:
    ae.decrypt(c, b"other ad"); out["aead_ad"] = "opened"
except nacl.exceptions.CryptoError as e:
    out["aead_ad"] = type(e).__name__
pt = b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it."
out["aead_rfc8439"] = b.crypto_aead_chacha20poly1305_ietf_encrypt(pt, h("50515253c0c1c2c3c4c5c6c7"), h("070000004041424344454647"), h("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f")).hex()
print(json.dumps(out))
`;

export default async function (ctx) {
  const { assert } = ctx;
  const out = await py(ctx, 'nacl_box', SCRIPT, [JSON.stringify(V)]);
  const o = JSON.stringify(out);
  assert.equal(out.alice_pk, V.alice_pk, o);
  assert.equal(out.box, V.box, `Box known answer: ${o}`);
  assert.equal(out.box_nonce, true, o);
  assert.equal(out.box_open, 'homescoop wasix-libsodium known answer', o);
  assert.equal(out.box_tampered, 'CryptoError', o);
  assert.equal(out.secretbox, V.secretbox, `SecretBox known answer: ${o}`);
  assert.equal(out.secretbox_open, 'homescoop wasix-libsodium known answer', o);
  assert.equal(out.secretbox_random_nonce, true, o);
  assert.equal(out.secretbox_wrong_key, 'CryptoError', o);
  assert.equal(out.aead_xchacha, true, o);
  assert.equal(out.aead_ad, 'CryptoError', o);
  assert.equal(out.aead_rfc8439, V.aead, `ChaCha20-Poly1305 IETF, RFC 8439 2.8.2: ${o}`);
  assert.equal(typeof out.shared, 'string', o);
  console.log('nacl.public.Box and nacl.secret.SecretBox: known ciphertexts (native libsodium), open, tamper and wrong key raise CryptoError; nacl.secret.Aead round trip and AD check; RFC 8439 ChaCha20-Poly1305');
}
