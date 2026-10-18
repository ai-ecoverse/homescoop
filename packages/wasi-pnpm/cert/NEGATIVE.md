# Negative proof (wasi-pnpm cert/, homescoop#478, #522)

**Date:** 2026-10-16. `cert/install.mjs` ran on slicc-kernel 1.94.0 with users enforce (macOS arm64 builds, `--soft`). On 12.9.1-9 every case passes, in 43 s.

## 12.9.1-8 (no 0002): build paths in pnpm.wasm (#522)

On the published 12.9.1-8, every behaviour case passes, and the build-path check fails:

```text
install.mjs:121    pnpm.wasm contains a build path ("/home/runner")
install.mjs:121#3  pnpm.wasm contains a build path ("homescoop-work/pnpm-")
```

It carries pnpm-cli's `CARGO_MANIFEST_DIR`, `/home/runner/work/_temp/homescoop-work/pnpm-5dafb098…/pnpm/crates/cli`. It also carries 7 `/home/runner/.cargo/registry/…/tree-sitter-0.26.9/…` paths, the `__FILE__` of tree-sitter's C asserts. 12.9.1-9 has neither: 0002 removes the first, and `TARGET_CFLAGS=-ffile-prefix-map=…` remaps the second. A local build has 561 `/cargo/registry/…` paths and no host path, and `build.sh`'s new strings check refuses any that comes back.

## Without 0001 (parking_lot_core's `nightly` feature)

A build of the same tree without 0001 links the panicking wasm parker. The cert fails at the 0001 check:

```text
install.mjs:122  pnpm.wasm links parking_lot_core's panicking wasm parker (0001 missing)
```

The installs alone don't catch it. In this harness, the spec's three 30-package installs never made a lock park, and neither did a stress run of three 200-package installs with 8 files each and 0–40 ms of registry latency per response. All of them passed without 0001. So 0001's runtime trap (the original reason for the patch) stays covered by the string check and by build.sh.

That build also showed that build.sh's old parker check, `strings … | grep -q …` under `set -o pipefail`, never fired. grep's early exit kills `strings` with SIGPIPE, and the pipeline then reads as "no match". The build without 0001 passed the check (`old-guard-MISSED`). The check now greps to `/dev/null` and catches it.

## Empty wasm (spec not vacuous)

`prove-negative.mjs --package wasi-pnpm` fails at the first `pnpm --version`.

## 12.9.1-10: function names for a trap (2026-10-18)

The published 12.9.1-9 against 12.9.1-10's `install.mjs` (slicc-kernel 1.94.0, users enforce, `--soft`): **FAIL, 10 of 52 assertions.** There is no `bin/pnpm.wasm.names`, and pnpm.wasm has a `name` section of generated names only (`f4998` for function 5000: build.mjs's wasm2wat `--generate-names --no-debug-names` / wat2wasm `--debug-names` round trip). Under `SLICC_WASM_BACKTRACE=1`, SLICC then names no frame: the kernel reads a sidecar only for a module without a name section. That is why bios's `pnpm: wasm trap in thread 4: memory access out of bounds` named nothing.

A local 12.9.1-10-style build (same tree; macOS, so not byte-identical to CI's) passes. names.py found 32445 function names, plus the 2 imports, and checked that the exports `_start`, `malloc`, `free`, `wasi_thread_start` and `__wasm_init_tls` carry their own names at their instrumented indices.

## 12.9.1-11: no half-there packages during an update (homescoop#1128, 2026-10-18)

The published 12.9.1-10 against 12.9.1-11's `cert/update-readers.mjs` (slicc-kernel 1.124.2, users enforce, `--soft`, slicc-heavy): **FAIL.** The observations:
- `big 240 1.0.0` 825 times and `big 260 2.0.0` 11 times (complete);
- **`big` half there 43 times, with 0 to 217 files in lib/:** upstream's stage_and_swap deletes the old tree file by file before the new one is renamed in;
- `fresh absent` 608 times and `fresh 200 1.0.0` 97 times;
- **`fresh` half there 174 times, with 0 to 199 files and no package.json:** a new package is populated in place.

12.9.1-11's patches/0004 renames the old tree aside, renames the staged one in and only then deletes the old one, and it stages a new package before renaming it into place. The pnpm deps-restorer crate's own unit tests pass with the patch (633 of 633, host `cargo test -p pnpm-deps-restorer --lib`). Upstream's RemoveExisting test (a failing remove_dir_all before the swap) is replaced by one checking that an unremovable old tree no longer fails the swap.

