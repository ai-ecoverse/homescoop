# Negative proof (curl)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`.

## Empty wasm

With `bin/curl.wasm` truncated to 0 bytes, the checklist fails at the first
`curl` (slicc-kernel 1.23.0, Node entry):

```
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## Known-bad build: curl without zlib

`build.sh` with `-DCURL_ZLIB=OFF` (built locally, not committed) fails the
checklist at `curl --version` (no `zlib/1.3.1`). With that assertion
removed, it fails again at `--compressed`:

```
curl -sS --compressed https://cert.test/gz: rc=2 stderr=curl: option --compressed: the installed libcurl version does not support this
```

## Spec non-vacuous

Without the `wasm-tls-engine` peer, the kernel answers `CONNECT` with 501
and every https case fails (`curl: (7) CONNECT tunnel failed, response
501`). The spec compares response bodies and exit codes exactly (22, 47, 60,
77, 1, 23), checks the downloaded binary by sha256, and asserts that the
decoy CA is rejected while `-k` accepts it.

The published 8.22.0-1 also passes the checklist, so the new build shows no
regression on these cases.

## Tailnet names (8.22.0-3, homescoop#139)

`cert/tailnet.mjs` against the published 8.22.0-2 (socket shim without the
kernel resolver), slicc-kernel 1.28.0 with the fake uplink:

```
rc=6 stderr=curl: (6) Could not resolve: peer.tail1234.ts.net:8080
```

## Own hostname (8.22.0-4, #149)

The published 8.22.0-3 (#140's shim) sends the machine's own name to the
uplink, which does not know it:

```
emscripten:1 rc=6 stderr=curl: (6) Could not resolve: emscripten:1
```

## The slicc shims and credentials (8.22.0-4, #459, #625)

`8.22.0-4`'s `bin/curl.wasm` exports none of the slicc shims' symbols and imports nothing from them. CMake's Release type adds `-O3` to the link line, and `emcc -O3` drops their `EMSCRIPTEN_KEEPALIVE` exports, so the `--whole-archive` net shims and the credential library never reach the binary. On main, host-run's `check-slicc-cred.mjs` therefore refused to build curl:

```text
homescoop: bin/curl.wasm (an Emscripten command) lacks the slicc credential library (import slicc_cred_js, export slicc_cred_euid): slicc-kernel shows every file as 1000:1000 under users (homescoop#459)
  check-slicc-cred: 0 of 1 wasm link the slicc shims; 1 Emscripten command wasm; 1 problem(s)
```

8.22.0-5 builds with `CMAKE_C_FLAGS_RELEASE=-DNDEBUG`, so it compiles and links at `-O2`. Its wasm exports `slicc_sig_mask`, `slicc_raise`, `slicc_sigpipe` and `slicc_cred_euid`, and imports `slicc_cred_js` and the net shims' `slicc_socket_js`, `slicc_poll_js` and the rest.

## users.mjs (users enforce, #723)

**Date:** 2026-10-16, slicc-kernel 1.102.6 `--users enforce`.

- `prove-negative.mjs --package curl --spec users.mjs --users enforce` → FAIL
  (`WebAssembly.compile(): BufferSource argument is empty`).
- The npm build without the credential library (curl 8.22.0-4, qpdf
  12.4.2-1) passes users.mjs on 1.102.6 too: the kernel refuses the opens
  and stamps the creator's ids itself. The spec guards the behaviour as a
  non-root user; host-run's `check-slicc-cred.mjs` guards the link. That
  build fails glue-by-path (0644 glue, `EACCES`).
