# Negative proof (wasix-websocat)

**Date:** 2026-10-15, slicc-kernel 1.95.0 (users enforce), local builds of 4.0.0-alpha3-1 from this recipe (package.tgz `6d8b89b8…`). This is the package's first cert.

## Empty wasm

```
browser-cert: FAIL packages/wasix-websocat/cert/frames.mjs
browser-cert: FAIL packages/wasix-websocat/cert/loopback.mjs (crash at packages/wasix-websocat/cert/loopback.mjs:13)
Error: Error: WebAssembly.compile(): BufferSource argument is empty
browser-cert: FAIL packages/wasix-websocat/cert/version.mjs (crash at packages/wasix-websocat/cert/version.mjs:3)
prove-negative: ok — cert failed on bad wasix-websocat tarball (status 1)
```

## Without homescoop's mio patches

Built from this recipe with `mio/*.patch` left out (the wasix-org mio fork as published, package.tgz `09f51fa6…`). `version.mjs` still passes, since it opens no socket. The socket specs fail:

```
browser-cert: FAIL packages/wasix-websocat/cert/frames.mjs
AssertionError [ERR_ASSERTION]: an HTTP response:
browser-cert: FAIL packages/wasix-websocat/cert/loopback.mjs
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ 'no exit within 30000 ms'
- 0
```

The server accepts the first connection and then blocks its only thread on the listener, because the fork opens blocking sockets (mio/0001). With mio/0001 alone, every client fails at once with `Operation in progress (os error 26)`: the non-blocking connect's EINPROGRESS is returned as an error (mio/0002).

## On slicc-kernel 1.94.0

Without WASIX epoll and eventfd (slicc-kernel#674, in 1.95.0), every invocation, `--version` included, aborts with `Failed building the Runtime: Os { code: 52, kind: Unsupported, message: "Function not implemented" }`. Hence `engines.slicc-kernel >=1.95.0`.

## The specs aren't vacuous

- `version.mjs`: the exact version line, plus the installed notices' tokio, rustls, ring, webpki-roots, patched mio, wasix-org Rust std and wasix-sysroot sections.
- `loopback.mjs`, as cone:
  - exact text echoes;
  - 1 MiB and 16 MiB binary round trips compared byte for byte;
  - five concurrent clients, each with its own echo;
  - a refused port's rc 14 and message;
  - without an exit, rc 21 (os error 44) for a name and rc 14 `Network unreachable` for an outer address, both within 10 s.
- `frames.mjs` reads the raw server bytes:
  - 101 with the RFC 6455 accept key for the RFC's sample nonce;
  - `8a 04 "ping"` for a ping;
  - `88 02 0f a0` for close 4000;
  - `81 02 "hi" 88 02 03 e8` for a text frame and then close 1000.
