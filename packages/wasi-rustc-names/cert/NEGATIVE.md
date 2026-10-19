# Negative proof (wasi-rustc-names)

## 1.98.1-5: the first CI-built release, with its own recipe (#876)

**Date:** 2026-10-17.

**Supply chain.**
- 1.98.1-4 (npm latest) was split off a `wasi-rustc-stable.yml` artifact on a laptop (`stage-patched.py`). It has no recipe, provenance or gitHead, so cert-review's root rule gives it INCOMPLETE ("unverifiable input").
- 1.98.1-5 comes from this recipe, which runs wasi-rustc's own reproducible build from the same pinned source, wasi-llvm and wasi-sdk. `build.sh` ships the names only if the rebuilt, stripped `rustc.wasm` is byte-identical to the published `@ai-ecoverse/wasi-rustc@1.98.1-5` (fetched by sha256, `sources.wasi_rustc`). So each release of this package is also an independent reproduction of wasi-rustc.

**The check is not vacuous.** `test/check.mjs`:
- The published 1.98.1-4 names checked against the published wasi-rustc 1.98.1-5 → FAIL, 2 cases: the version, and `one name per function: 231308 names, highest index 231307; rustc.wasm has 231821 functions`.
- The same 1.98.1-4 names against their own wasi-rustc 1.98.1-4 → all checks pass: 231,308 names for 231,308 functions, rustc_driver and LLVM symbols present, and the reassembled module validates.
- A names file that doesn't belong to the binary is caught even when the module would still validate.

## 1.98.1-6: follows wasi-rustc 1.98.1-6 (2026-10-19)

wasi-rustc 1.98.1-6 adds LLVM Support's notices (#1086) and pins wasi-llvm 21.1.8-2. Its rustc.wasm is byte-identical to 1.98.1-5's: the same libraries, and the published tarballs' rustc.wasm compare equal. This release pins both (wasi-rustc 1.98.1-6 `f42f669d…8cf1`, wasi-llvm 21.1.8-2 `5181c65f…312e`). Its build again ships the names only if the rebuilt rustc.wasm is byte-identical to the published 1.98.1-6. The published 1.98.1-5 names checked against wasi-rustc 1.98.1-6 fail only on the version: the package must be at wasi-rustc's version.
