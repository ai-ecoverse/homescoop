# Negative proof (wasm-binutils)

## 2.47.0-5: wasm modules with DataCount and Tag sections (homescoop#646; 2026-10-17)

Runs: slicc-kernel 1.110.1, users enforce, `scripts/browser-cert/run.mjs` with this PR's specs, and wasm-bash 5.3.0-19 and wasm-coreutils 9.12.0-9 installed.

- **The published 2.47.0-4** passes `checklist.mjs` and fails `wasm.mjs`. The MVP module reads fine. The first module with a DataCount section (id 12) is refused:
  ```
  browser-cert: FAIL packages/binutils/cert/wasm.mjs
  AssertionError [ERR_ASSERTION]: size -A on a module with a DataCount section (12): rc=3 size: datacount.wasm: file format not recognized
  ```
  The same happens to the Tag module (13) and to Emscripten's own bash.wasm (sections 1-7, 9, 12, 10, 11, 0): BFD's `wasm-module.c` names ids 1-11 only and gives up on the rest.
- **This build (2.47.0-5, with `wasm-datacount-tag.patch`)** passes both specs. `size -A` lists `.wasm.datacount` and `.wasm.tag`, and bash.wasm's import, datacount, code and data sections. The Berkeley table prints zeros, since no wasm section is allocated text, data or bss. An unknown id (14) is still `file format not recognized`.
