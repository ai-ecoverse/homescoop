// nacl.pwhash: Argon2id / Argon2i known answers (Node's crypto.argon2) at
// 8 MiB and at Argon2id's INTERACTIVE (64 MiB), MODERATE (256 MiB) and
// SENSITIVE (1 GiB) limits, str/verify, and scrypt (RFC 7914).
import { readFileSync } from 'node:fs';
import { py } from '../test/cert-py.mjs';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const SCRIPT = String.raw`
import json, time
import nacl.bindings as b
import nacl.exceptions, nacl.pwhash
from nacl.pwhash import argon2i, argon2id, scrypt
salt, pw = bytes(range(16)), b"correct horse"
out = {}
t = time.monotonic()
out["argon2id"] = argon2id.kdf(32, pw, salt, opslimit=3, memlimit=8 << 20).hex()
out["argon2i"] = argon2i.kdf(32, pw, salt, opslimit=3, memlimit=8 << 20).hex()
out["interactive"] = argon2id.kdf(32, pw, salt, opslimit=argon2id.OPSLIMIT_INTERACTIVE, memlimit=argon2id.MEMLIMIT_INTERACTIVE).hex()
out["limits"] = [argon2id.OPSLIMIT_INTERACTIVE, argon2id.MEMLIMIT_INTERACTIVE, argon2id.OPSLIMIT_MODERATE, argon2id.MEMLIMIT_MODERATE, argon2id.OPSLIMIT_SENSITIVE, argon2id.MEMLIMIT_SENSITIVE]
out["moderate"] = argon2id.kdf(32, b"pw", bytes(16), opslimit=argon2id.OPSLIMIT_MODERATE, memlimit=argon2id.MEMLIMIT_MODERATE).hex()
out["sensitive"] = argon2id.kdf(32, b"pw", bytes(16), opslimit=argon2id.OPSLIMIT_SENSITIVE, memlimit=argon2id.MEMLIMIT_SENSITIVE).hex()
h = nacl.pwhash.str(b"hunter2")
out["str_prefix"] = h[:31].decode()
out["verify"] = nacl.pwhash.verify(h, b"hunter2")
try:
    nacl.pwhash.verify(h, b"hunter3"); out["verify_wrong"] = "verified"
except nacl.exceptions.InvalidkeyError as e:
    out["verify_wrong"] = type(e).__name__
out["scrypt_rfc7914"] = b.crypto_pwhash_scryptsalsa208sha256_ll(b"password", b"NaCl", 1024, 8, 16, dklen=64).hex()
sh = scrypt.str(b"pw", opslimit=scrypt.OPSLIMIT_INTERACTIVE, memlimit=scrypt.MEMLIMIT_INTERACTIVE)
out["scrypt_verify"] = scrypt.verify(sh, b"pw")
out["seconds"] = round(time.monotonic() - t, 1)
print(json.dumps(out))
`;

export default async function (ctx) {
  const { assert } = ctx;
  const out = await py(ctx, 'nacl_pwhash', SCRIPT);
  const o = JSON.stringify(out);
  assert.equal(out.argon2id, V.argon2id, `Argon2id t=3 m=8 MiB p=1 (Node crypto.argon2): ${o}`);
  assert.equal(out.argon2i, V.argon2i, `Argon2i t=3 m=8 MiB p=1: ${o}`);
  assert.deepEqual(out.limits, [2, 64 << 20, 3, 256 << 20, 4, 1 << 30], o);
  assert.equal(out.interactive, V.argon2id_interactive, `Argon2id INTERACTIVE (t=2, 64 MiB): ${o}`);
  assert.equal(out.moderate, V.argon2id_moderate, `Argon2id MODERATE (t=3, 256 MiB): ${o}`);
  assert.equal(out.sensitive, V.argon2id_sensitive, `Argon2id SENSITIVE (t=4, 1 GiB) fits in python's wasm32 heap: ${o}`);
  assert.equal(out.str_prefix, '$argon2id$v=19$m=65536,t=2,p=1$', o);
  assert.equal(out.verify, true, o);
  assert.equal(out.verify_wrong, 'InvalidkeyError', o);
  assert.equal(out.scrypt_rfc7914, V.scrypt, `scrypt RFC 7914 (N=1024, r=8, p=16): ${o}`);
  assert.equal(out.scrypt_verify, true, o);
  console.log(`nacl.pwhash: Argon2id/Argon2i known answers at 8 MiB, Argon2id INTERACTIVE (64 MiB), MODERATE (256 MiB) and SENSITIVE (1 GiB) known answers, str/verify, scrypt RFC 7914 and str/verify (${out.seconds} s)`);
}
