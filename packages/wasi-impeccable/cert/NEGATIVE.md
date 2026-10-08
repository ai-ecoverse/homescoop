# Negative proof (wasi-impeccable)

**Date:** 2026-10-08

## Empty wasm (spec not vacuous)

`prove-negative.mjs --package wasi-impeccable` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).

## Patch reverted (0001-wasi-detect-only-cli.patch)

Remove `packages/wasi-impeccable/0001-wasi-detect-only-cli.patch` and run
`bash scripts/host-run.sh wasi-impeccable` against engine-v0.1.12.

**Result:** compile fails in the `socks` crate (pulled by `ureq` `socks-proxy`
via `impeccable-context`):

```text
error[E0599]: no method named `writev` found for struct `UdpSocket`
error[E0599]: no method named `readv` found for struct `UdpSocket`
error: could not compile `socks` (lib) due to 2 previous errors
```

**Good tarball:** candidate from this PR once CI host-build succeeds —
`cert/checklist.mjs` under slicc-kernel@1.15.1.
