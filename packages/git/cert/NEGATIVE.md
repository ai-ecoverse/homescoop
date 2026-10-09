# Negative proof (git)

**Date:** 2026-10-07  
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package git` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/checklist.mjs` asserts clone/show after push yields
`homescoop-git-cert\n`, then after fetch/merge `homescoop-git-cert-2\n`.

## Tailnet names (2.55.0-11, homescoop#139)

`cert/tailnet.mjs` against the published 2.55.0-10 (socket shim without the
kernel resolver), slicc-kernel 1.28.0 with the fake uplink:

```
ls-remote rc=128 stderr=fatal: unable to access 'http://peer.tail1234.ts.net:8080/repo.git/': Could not resolve: peer.tail1234.ts.net:8080
```

## Own hostname to the uplink (2.55.0-11 before #149)

The first 2.55.0-11 build (7501856b…, #140's shim) fails the local-workflow
case: the clone's default ident resolves the hostname through the uplink.

```
AssertionError: a local git workflow asked the uplink
+ [ { family: 4, name: 'emscripten' } ]
```
