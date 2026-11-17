// Ed25519 (RFC 8032 tests 1 and 2) through nacl.signing, verify, tamper,
// and the Ed25519 -> Curve25519 key conversion.
import { readFileSync } from 'node:fs';
import { py } from '../test/cert-py.mjs';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const SCRIPT = String.raw`
import json
import nacl.exceptions
from nacl import encoding, signing
h = bytes.fromhex
out = {}
k1 = signing.SigningKey(h("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"))
out["pk1"] = k1.verify_key.encode(encoding.HexEncoder).decode()
out["sig1"] = k1.sign(b"").signature.hex()
k2 = signing.SigningKey(h("4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb"))
s2 = k2.sign(b"\x72")
out["pk2"] = k2.verify_key.encode().hex()
out["sig2"] = s2.signature.hex()
out["verify"] = k2.verify_key.verify(s2) == b"\x72"
vk = signing.VerifyKey(k2.verify_key.encode(encoding.Base64Encoder), encoding.Base64Encoder)
out["verify_b64key"] = vk.verify(b"\x72", s2.signature) == b"\x72"
try:
    vk.verify(b"\x73", s2.signature); out["tampered"] = "verified"
except nacl.exceptions.BadSignatureError as e:
    out["tampered"] = type(e).__name__
g = signing.SigningKey.generate()
out["generated"] = g.verify_key.verify(g.sign(b"hi")) == b"hi"
out["x25519"] = k2.verify_key.to_curve25519_public_key().encode().hex()
print(json.dumps(out))
`;

export default async function (ctx) {
  const { assert } = ctx;
  const out = await py(ctx, 'nacl_signing', SCRIPT);
  const o = JSON.stringify(out);
  assert.equal(out.pk1, V.ed_pk1, `RFC 8032 test 1 public key: ${o}`);
  assert.equal(out.sig1, V.ed_sig1, `RFC 8032 test 1 signature: ${o}`);
  assert.equal(out.pk2, V.ed_pk2, o);
  assert.equal(out.sig2, V.ed_sig2, `RFC 8032 test 2 signature: ${o}`);
  assert.equal(out.verify, true, o);
  assert.equal(out.verify_b64key, true, o);
  assert.equal(out.tampered, 'BadSignatureError', o);
  assert.equal(out.generated, true, o);
  assert.equal(out.x25519, V.ed_x25519_pk2, o);
  console.log('nacl.signing: RFC 8032 tests 1 and 2 (keys and signatures), verify, BadSignatureError on a changed message, generate/sign/verify, to_curve25519_public_key');
}
