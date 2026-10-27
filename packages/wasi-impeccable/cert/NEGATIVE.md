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

## 0.1.15-6: the stress row's harness calls, deep markup, the allocator's cost (2026-10-20)

- **`cert/stress.mjs`** (homescoop#1363): 0.1.15-5's row ran each 600-page detect in one harness call, which on a slow runner passed 120 s ("Runtime.evaluate: no answer"). Since -6 detect runs detached and the spec polls it once a second. Locally, 4 runs (2 × -4, 2 × -5, alternated; slicc-kernel 1.134.3) all pass, with rounds of 17–45 s and no call near the limit.
- **homescoop#1364** (is the allocator refresh's realloc slower?): **not reproduced.** In those 12 rounds per version, the median detect is 27.5 s for 0.1.15-4 and 20 s for 0.1.15-5 (both noisy, 17–45 s), and output and traps (0) are the same. The refresh keeps realloc as alloc + copy + free on purpose: libc's realloc copies into a block it may have just taken from memory another thread grew, before the wrapper could refresh the view, and that copy is the trap.
- **`cert/deep.mjs`** (homescoop#620): upstream behaviour, documented, so -5 passes it too. On -5 here, 1000 and 2000 deep take 1.0 s and 3.8 s (2.1 s and 8.3 s on kernel 1.94.0 in the issue).


## 0.1.16-1: `detect --cdp` refuses on WASI (cert/cdp.mjs, 2026-10-27)

0.1.16 adds `detect --cdp <port|url>`, which attaches to a running Chromium-based app through its DevTools port. In this build there's no browser engine, so the patch makes it refuse the way URL scans do. `cert/cdp.mjs` against the published `@ai-ecoverse/wasi-impeccable@0.1.15-6` on slicc-kernel 1.134.3 (users enforce):

```text
browser-cert: FAIL packages/wasi-impeccable/cert/cdp.mjs
AssertionError [ERR_ASSERTION]: detect --cdp 9222 stderr="Warning: cannot access 9222\n"
  expected: /^Error: --cdp scans need a browser; not available in this build yet$/m
```

0.1.15-6 has no `--cdp`: it drops the flag and scans `9222` as a missing file. The 0.1.16-1 build passes it, with the other specs (checklist, deep, notices, telemetry, stress) and test/e2e on the same kernel. Without the patch's `detect_cdp_scan` it would print upstream's `Error: this build cannot attach to a running app (--cdp)`, which the spec also refuses.

Stress row, re-run for the moved HTTP core: 0.1.16-1 gives 0 traps in 6 rounds (13 s each), and the wasm memory never grows past the 64 MiB initial heap. Linked without `--initial-memory`, 0.1.16-1 peaks at 21 MiB under today's `stress.mjs` (polled once a second), and so does the published 0.1.15-4. recipe.yaml keeps its 64 MiB initial heap and the larger 49 MiB measurement.
