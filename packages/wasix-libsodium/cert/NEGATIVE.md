# Negative proof (wasix-libsodium)

**Date:** 2026-11-17 (1.0.22-1). New package, so it needs human cert first.

`node scripts/wasix-lib-cert.mjs wasix-libsodium --tarball <tgz>` and
`node packages/wasix-libsodium/test/upstream-tests.mjs --tarball <tgz>` on
slicc-kernel 1.189.2's Node entry. The good tarball passes both: `sodiumprobe`
and `sodiumprobe-pic`, and 202 of 202 upstream tests (101 x 2 flavours).

## Without libsodium-argon2-wasm32-fblamka.patch

The same recipe built with the patch removed (sha256 `59386db1…`, against the
good `68a1ffe8…`). wasixcc enables `simd128` for every WASIX build, so Argon2
takes libsodium 1.0.22's wasm32 SIMD `fill_segment`, whose `fBlaMka` multiplies
u32 lanes 0 and 1 instead of the low half of each 64-bit lane. Every Argon2
hash comes out wrong while everything else passes:

```text
FAIL cert/probe.mjs
AssertionError [ERR_ASSERTION]: sodiumprobe: rc=1 stdout=libsodium 1.0.22
randombytes sysrandom
FAIL argon2id 8 MiB
```

```text
FAIL pwhash_argon2i: rc=99
FAIL pwhash_argon2id: rc=99
FAIL pwhash_argon2i-pic: rc=99
FAIL pwhash_argon2id-pic: rc=99
upstream-tests: 198 passed, 4 failed (101 tests x 2 flavours)
```

For example `crypto_pwhash(32, "correct horse", salt 00..0f, 3, 8 MiB,
ARGON2ID13)` gives `b4cd035f…` instead of `77af1c30…` (Node's
`crypto.argon2Sync` and a native libsodium agree on the latter). Upstream
fixed it after 1.0.22 (1b37a23c55, "fBlaMka webassembly: properly multiply
the low 32-bits of each lane"); the patch is that commit.

## Empty probe

A 0-byte `sodiumprobe.wasm` fails at `WebAssembly.compile` (`BufferSource
argument is empty`), as with every package's empty-wasm check.
