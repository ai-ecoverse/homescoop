# Negative proof (wasix-websocat)

**Date:** 2026-10-16. The 4.0.0-alpha3-1 build from this recipe on main 35928284 (wasix-sysroot 2025.9.30-30, package.tgz `248cf42c…`) passes `frames`, `loopback` and `version` on slicc-kernel 1.95.0 (the floor) and on 1.102.6 (the root package.json pin), users enforce, and `test/uplink.mjs` on both. The negatives below are from the same recipe on wasix-sysroot -28 (2026-10-15). This is the package's first cert.

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

## Through the uplink (`test/uplink.mjs`, the `ci` command)

- **Without the mio patches:** the first `ws://echo.test/` through the uplink never exits:
  ```
  AssertionError [ERR_ASSERTION]: ws:// through the uplink: no exit within 30 s
  ```
- **With mio/0001 and mio/0002 but not mio/0003:** ws://, wss:// -k and the strict wss:// refusal pass, but a refused uplink port isn't reported. The kernel refuses the non-blocking connect asynchronously, and the target's Rust std `take_error()` always answers `None`, so websocat writes to a dead socket and exits **0** with `ERROR … operation was canceled`. The spec wants rc 14 `Connection refused`.
- **The strict wss:// case** is itself the negative of `-k`: without `-k`, the throwaway CA is refused (rc 8, an invalid peer certificate). So chain verification is on, and the `-k` run proves only the handshake and framing.

## Subprocess specifiers (`subprocess.mjs`, 4.0.0-alpha3-2, homescoop#689)

Against the published 4.0.0-alpha3-1, which has no `0002` patch, on slicc-kernel 1.95.0 with users enforce: the `cmd:` server never exits. It waits for a connection and then panics in the wasix std's `process.rs` ("not implemented"):

```
browser-cert: FAIL packages/wasix-websocat/cert/subprocess.mjs
AssertionError [ERR_ASSERTION]: websocat -s 18110 cmd:tr a-z A-Z: no exit within 20 s
```

With `0002`, all three forms (`-s … cmd:`, `ws-l:… exec:cat`, `… sh-c:cat`) exit non-zero at once, with `exec:, cmd: and sh-c: are not supported on WASIX`.

## `--exec-after-listen` and `-x` subprocesses (4.0.0-alpha3-3, homescoop#709)

Against the published 4.0.0-alpha3-2 (no `0003`), on slicc-kernel 1.95.0 with users enforce, `subprocess.mjs` fails at `--exec-after-listen`. The command runs (`hi` is printed), and then websocat aborts in tokio's I/O driver (rc 134, `unexpected error when polling the I/O driver … I/O error`):

```
browser-cert: FAIL packages/wasix-websocat/cert/subprocess.mjs
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /--exec-after-listen is not supported on WASIX/. Input:
'hi\n' + 'Using --binary mode by default\n' + …
```

With `0003`, `--exec-after-listen` exits non-zero before it listens, and `-x` scripts calling `execute()`, `execute_for_status()` or `system()` fail with `subprocesses are not supported on WASIX`, with no abort.

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
