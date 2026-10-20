# Negative proof (wasi-impeccable)

**Date:** 2026-10-08 (0.1.12-4); 0.1.12-5 the same day

## Empty wasm (spec not vacuous)

`prove-negative.mjs --package wasi-impeccable` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).

## Patch reverted (0001-wasi-cli.patch)

Remove `packages/wasi-impeccable/0001-wasi-cli.patch` and run
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

## THIRD-PARTY-NOTICES.md names the wrong wasi-sdk (0.1.15-1, homescoop#472)

`cert/notices.mjs` against the published `@ai-ecoverse/wasi-impeccable@0.1.15-1` on
slicc-kernel 1.15.1:

```text
browser-cert: FAIL packages/wasi-impeccable/cert/notices.mjs
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+   "## wasi-libc (wasi-sdk-31; Rust's self-contained wasm32-wasip1-threads libc)"
-   "## wasi-libc (wasi-sdk-33; Rust's self-contained wasm32-wasip1-threads libc)"
```

Rust 1.98.1 builds its self-contained wasm32-wasip1-threads libc with
`WASI_SDK_PATH=/tmp/wasi-sdk-33.0-x86_64-linux`. The four licence files are
the same at both tags, so only the heading and the URLs were wrong.
`scripts/check-rust-wasi-sdk.mjs` now checks the table against that
Dockerfile on every build.

## CARGO_HOME registry paths in impeccable.wasm (0.1.15-1, homescoop#471)

0.1.15-1 built without `--remap-path-prefix`, so the panic locations of the registry crates kept the runner's paths. `strings bin/impeccable.wasm` on the published 0.1.15-1 finds 203 of them (`/home/runner/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/regex-automata-0.4.18/…`, `zlib-rs-0.6.7`, `png-0.18.1`, …), so its bytes depend on where CARGO_HOME is. 0.1.15-3's host-path guard (`/Users/|/home/[^/]+/|/tmp/|/private/(tmp|var)/|/var/folders/|/rustup/`) matches all 203 and fails the build. The old guard (`/Users/[^/]+/Developer|/var/folders/`) matched none.

With the remap, two macOS builds with different CARGO_HOMEs (`~/.cargo` and a fresh `/tmp/…/cargo2`, which downloaded every crate again) and different work trees (`/tmp/…` and `~/.cache/…`) gave the same `impeccable.wasm` (sha256 `9d4eaf1e…`, 2026-10-16). It has 203 `/cargo/registry/…` paths and no host path.

## No telemetry verb (0.1.14-2, homescoop#482)

`cert/telemetry.mjs` on the published 0.1.14-2 (slicc-kernel 1.94.0, users enforce) fails at its first step:

```text
AssertionError [ERR_ASSERTION]: rc=1
--- stderr
Unknown command: "telemetry"
```

The spec doesn't pass vacuously. With its roll API inverted to demand the opposite header on opted-out rolls, it fails on 0.1.15-3 at the first opted-out roll: `SURFACE CONCEPT SEED (key: off-1; mode: unscoped; source: degraded; …)`.

## 0.1.15-5: the allocator refresh and the initial heap (homescoop#1287, 2026-10-20)

The published 0.1.15-4 passes the new stress row's traps check: 6 rounds over 600 pages, 0 traps on slicc-kernel 1.134.3. The trap is a V8 race (slicc-kernel#1172) at 5–12% of rounds under heavier allocation (azw9's canary, wasi-pnpm's loop), so the row is a guard, not a negative. 0.1.15-4's peak there was 49 MiB, hence the recorded 64 MiB initial heap, which the row checks.

