// nacl.utils.random (randombytes_buf: WASI random_get), the deterministic
// generator, hashes, and the binding's version and feature flags.
import { readFileSync } from 'node:fs';
import { py } from '../test/cert-py.mjs';

const V = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'));
const SCRIPT = String.raw`
import json
import nacl, nacl.bindings as b, nacl.hash, nacl.utils
from nacl import encoding
out = {"version": nacl.__version__}
r = [nacl.utils.random(32) for _ in range(3)]
out["random"] = [len(x) for x in r] + [len(set(r)), sum(any(x) for x in r)]
out["random_big"] = len(nacl.utils.random(1 << 20))
out["deterministic"] = nacl.utils.randombytes_deterministic(64, bytes(range(32))).hex()
out["sha256"] = nacl.hash.sha256(b"abc", encoder=encoding.HexEncoder).decode()
out["sha512"] = nacl.hash.sha512(b"abc", encoder=encoding.HexEncoder).decode()
out["blake2b"] = nacl.hash.blake2b(b"abc", digest_size=64, encoder=encoding.HexEncoder).decode()
out["blake2b_keyed"] = nacl.hash.blake2b(b"abc", digest_size=32, key=bytes(range(32)), encoder=encoding.HexEncoder).decode()
out["siphash"] = nacl.hash.siphash24(b"homescoop wasix-libsodium known answer", key=bytes(range(16)), encoder=encoding.HexEncoder).decode()
out["scalarmult"] = b.crypto_scalarmult(bytes.fromhex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"), bytes.fromhex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f")).hex()
out["has_scrypt"] = b.has_crypto_pwhash_scryptsalsa208sha256
out["has_ed25519_core"] = b.has_crypto_core_ed25519
out["sodium_init"] = b.sodium_init() is None
print(json.dumps(out))
`;

export default async function (ctx) {
  const { assert } = ctx;
  const out = await py(ctx, 'nacl_utils', SCRIPT);
  const o = JSON.stringify(out);
  assert.equal(out.version, '1.6.2', o);
  assert.deepEqual(out.random, [32, 32, 32, 3, 3], `three random(32): 32 bytes each, all different, none all-zero: ${o}`);
  assert.equal(out.random_big, 1 << 20, o);
  assert.equal(out.deterministic, V.drbg, `randombytes_deterministic (ChaCha20): ${o}`);
  assert.equal(out.sha256, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', o);
  assert.equal(out.sha512, 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f', o);
  assert.equal(out.blake2b, V.generichash, `BLAKE2b-512 (Node crypto): ${o}`);
  assert.equal(out.blake2b_keyed, V.generichash_keyed, o);
  assert.equal(out.siphash, V.shorthash, o);
  assert.equal(out.scalarmult, V.shared, `X25519 RFC 7748: ${o}`);
  assert.equal(out.has_scrypt, true, `a full libsodium (not minimal): ${o}`);
  assert.equal(out.has_ed25519_core, true, o);
  assert.equal(out.sodium_init, true, o);
  console.log('nacl.utils.random: 32-byte draws differ and are non-zero, 1 MiB at once; randombytes_deterministic, SHA-256/512, BLAKE2b (plain and keyed), SipHash-2-4 and X25519 known answers; full libsodium (scrypt, core_ed25519)');
}
