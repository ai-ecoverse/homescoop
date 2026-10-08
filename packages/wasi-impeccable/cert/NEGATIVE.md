# Negative proof (wasi-impeccable)

**Date:** 2026-10-08 (0.1.12-4); 0.1.12-5 the same day

## Empty wasm (spec not vacuous)

`prove-negative.mjs --package wasi-impeccable` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).

## Patch reverted (0001-wasi-detect-only-cli.patch)

Remove `packages/wasi-impeccable/0001-wasi-detect-only-cli.patch` and run
`bash scripts/host-run.sh wasi-impeccable` against engine-v0.1.12.

**Result:** compile fails in the `socks` crate (pulled by `ureq` `socks-proxy`
via `impeccable-context`, which the patch keeps off the wasm target graph):

```text
error[E0599]: no method named `writev` found for struct `UdpSocket`
error[E0599]: no method named `readv` found for struct `UdpSocket`
error: could not compile `socks` (lib) due to 2 previous errors
```

## Non-root cwd (0.1.12-5)

0.1.12-4 took the working directory from `std::env::current_dir()`, which is
wasi-libc's and stays `/` in the kernel. Its `Io.cwd` joined relative paths
onto `/`. Checked against the published 0.1.12-4: `detect --json dirty.html`
from `/home/site` reports the finding as `/dirty.html`. The checklist's
non-root-cwd case asserts `/home/site/dirty.html`, so it fails without the
`PWD` fix in `crates/common/src/lib.rs`. It also checks that
`generate-image --out comps/fake.png` lands under the cwd, not `/`.

## HTTP verbs (0.1.12-5, test/e2e/http.test.mjs)

The e2e suite carries its own negatives. A zip with one byte flipped is
refused (digest), and so is a signature envelope with one hex digit changed
(`Bundle signature verification failed` from ed25519-dalek inside WASI).
Nothing is installed in either case, and `https://` without a proxy fails
with the no-TLS error.

**Good tarball:** CI artifact `@ai-ecoverse/wasi-impeccable@0.1.12-5`, with
`cert/checklist.mjs` under slicc-kernel@1.15.1 and test/e2e on its Node
entry.
