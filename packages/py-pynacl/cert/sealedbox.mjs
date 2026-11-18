// az's GitHub Actions secret path (azure/cli/command_modules/appservice/custom.py,
// _encrypt_github_actions_secret, azure-cli 2.93.0), verbatim, then the
// recipient opens it; and a sealed box made by a native libsodium opens.
import { readFileSync } from 'node:fs';
import { py } from '../test/cert-py.mjs';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const SCRIPT = String.raw`
import base64, json, sys
from nacl import encoding, public
import nacl.exceptions

def _encrypt_github_actions_secret(public_key, secret_value):
    # Encrypt a Unicode string using the public key
    from base64 import b64encode
    public_key = public.PublicKey(public_key.encode("utf-8"), encoding.Base64Encoder())
    sealed_box = public.SealedBox(public_key)
    encrypted = sealed_box.encrypt(secret_value.encode("utf-8"))
    return b64encode(encrypted).decode("utf-8")

v = json.loads(sys.argv[1])
bob = public.PrivateKey(bytes.fromhex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb"))
out = {"bob_pk": bob.public_key.encode().hex()}
repo_key = bob.public_key.encode(encoding.Base64Encoder).decode()
secret = "AZURE_CREDENTIALS={\"clientSecret\": \"s3cr\u00e9t\"}"
enc = [_encrypt_github_actions_secret(repo_key, secret) for _ in range(2)]
raw = [base64.b64decode(e) for e in enc]
out["len"] = [len(r) for r in raw]
out["differ"] = raw[0] != raw[1]
out["opened"] = [public.SealedBox(bob).decrypt(r).decode("utf-8") for r in raw]
out["secret"] = secret
out["known"] = public.SealedBox(bob).decrypt(bytes.fromhex(v["sealed"])).decode()
other = public.PrivateKey.generate()
try:
    public.SealedBox(other).decrypt(raw[0]); out["wrong_key"] = "opened"
except nacl.exceptions.CryptoError as e:
    out["wrong_key"] = type(e).__name__
t = bytearray(raw[0]); t[40] ^= 1
try:
    public.SealedBox(bob).decrypt(bytes(t)); out["tampered"] = "opened"
except nacl.exceptions.CryptoError as e:
    out["tampered"] = type(e).__name__
print(json.dumps(out))
`;

export default async function (ctx) {
  const { assert } = ctx;
  const out = await py(ctx, 'nacl_sealedbox', SCRIPT, [JSON.stringify(V)]);
  const o = JSON.stringify(out);
  assert.equal(out.bob_pk, V.bob_pk, `RFC 7748 public key: ${o}`);
  const n = Buffer.byteLength(out.secret, 'utf8') + 48;
  assert.deepEqual(out.len, [n, n], `sealed box is the secret plus 48 bytes (ephemeral key + MAC): ${o}`);
  assert.equal(out.differ, true, `two seals of one secret differ (fresh ephemeral keys): ${o}`);
  assert.deepEqual(out.opened, [out.secret, out.secret], o);
  assert.equal(out.known, 'homescoop wasix-libsodium known answer', `a box sealed by a native libsodium opens: ${o}`);
  assert.equal(out.wrong_key, 'CryptoError', o);
  assert.equal(out.tampered, 'CryptoError', o);
  console.log('nacl.public.SealedBox: az\'s _encrypt_github_actions_secret (base64 repo key -> sealed, base64) opens with the recipient key; an off-target sealed box opens; wrong key and a flipped byte raise CryptoError');
}
