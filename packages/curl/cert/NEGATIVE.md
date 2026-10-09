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
