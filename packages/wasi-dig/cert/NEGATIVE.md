# Negative proof (wasi-dig)

**Date:** 2026-10-10 (0.1.0-1)
New package, so it needs human cert first and is not in `scripts/ci-certified.json`.

`cert/checklist.mjs` was run on slicc-kernel 1.32.0's Node entry with `UPLINK=1`,
with the same transport traits and uplink peers as `scripts/browser-cert/page/page.js`.
The good build passes in about 0.6 s. The mutant below was the good source with one
change, built with the same toolchain (Rust 1.98.1, wasm32-wasip1).

## Empty wasm (spec not vacuous)

`bin/dig.wasm` truncated to 0 bytes, as `prove-negative.mjs` does:

```text
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## DNS over TCP without the length prefix

`transport.rs` sends the query without RFC 1035's two-byte length. The uplink
peer waits for a complete frame and never answers:

```text
AssertionError [ERR_ASSERTION]: dig @100.100.100.100 host.tailnet.test: rc=9 stderr=;; communications error to 100.100.100.100#53: 100.100.100.100:53: socket timed out
;; no servers could be reached
```
