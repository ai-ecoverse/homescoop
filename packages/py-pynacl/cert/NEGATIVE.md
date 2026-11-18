# py-pynacl: negative proof

## python-range.mjs: 1.6.2-1 nests a second python under a later 3.15 patch release (1.6.2-2; homescoop#1939; 2026-11-18)

npm `@ai-ecoverse/py-pynacl@1.6.2-1` takes wasix-python as the patch-line range. `npm install --package-lock-only` of its tarball beside a stand-in `@ai-ecoverse/wasix-python` 3.15.2-1 (a package.json-only tarball, `python-range.mjs`'s `fakePython`) resolves a second python from the registry: `node_modules/@ai-ecoverse/py-cffi/node_modules/@ai-ecoverse/wasix-python` 3.15.0-10, `node_modules/@ai-ecoverse/py-pynacl/node_modules/@ai-ecoverse/wasix-python` 3.15.0-10. `_slicc_site` refuses a py-\* whose python isn't the one running, so on wasix-python 3.15.2-1 its import would fail. 1.6.2-2's repack, with the series range, resolves one python, at the top level, with 3.15.1-1, 3.15.2-1 and 3.15.29-1 stand-ins and with the floor and newest from npm.

## 1.6.2-1: linked with a libsodium that has the wasm32 SIMD Argon2 bug (2026-11-17)

The same recipe, with `sources.wasix_libsodium` pointed at a wasix-libsodium
1.0.22 built without `libsodium-argon2-wasm32-fblamka.patch` (see
`packages/wasix-libsodium/cert/NEGATIVE.md`), on slicc-kernel 1.189.2 in
Chromium (`scripts/browser-cert/run.mjs`, wasix-python 3.15.0-8, py-cffi
2.1.1-1 and py-pycparser 3.12.0-1 from their PR builds). Every spec but one
passes; `cert/pwhash.mjs` fails at its first known answer:

```text
browser-cert: FAIL packages/py-pynacl/cert/pwhash.mjs
AssertionError [ERR_ASSERTION]: Argon2id t=3 m=8 MiB p=1 (Node crypto.argon2):
  {"argon2id":"b4cd035f…","argon2i":"c9e7b665…","interactive":"8266bb62…",
   "moderate":"93664fa1…","sensitive":"01f71cc4…",
   "str_prefix":"$argon2id$v=19$m=65536,t=2,p=1$","verify":true,…}
cert-run: FAIL py-pynacl fail
```

Note `verify: true`: a wrong Argon2 is self-consistent, so `nacl.pwhash.str`
followed by `verify` on the same build passes while every hash differs from
every other implementation's. Only the known answers catch it. The good build
gives `77af1c30…` (Argon2id 8 MiB), `9aab5a81…` (INTERACTIVE), `3777d9a6…`
(MODERATE) and `c1f28814…` (SENSITIVE), equal to Node's `crypto.argon2Sync`,
and passes every spec on wasix-python 3.15.0-1 and 3.15.0-8.

## Spec non-vacuous

- `sealedbox.mjs` runs az's function verbatim and also opens a box sealed by
  a native libsodium, so a sealed box that only round-trips on this build
  (a wrong X25519 or XSalsa20) fails.
- `box.mjs`, `signing.mjs` and `utils.mjs` compare exact bytes against RFC
  vectors, Node's crypto or a native libsodium, not only round trips.
- `import.mjs` imports `nacl._sodium`, which imports `_cffi_backend`: without
  `@ai-ecoverse/py-cffi` it fails with `ModuleNotFoundError: No module named
  '_cffi_backend'`.
