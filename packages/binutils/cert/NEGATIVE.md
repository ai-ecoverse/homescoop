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

## 2.47.0-6: no DWARF, no build paths (homescoop#908; 2026-10-17)

The published 2.47.0-5 also has 90 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/size.wasm, bin/strings.wasm, bin/readelf.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

2.47.0-6 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 2.47.0-5 too; the negative is the #908 check.

## 2.47.0-7: the cert under users enforce (homescoop#819; 2026-10-18)

2.47.0-7 changes no code or build input. The bump exists because ladder-pr rebuilds the package for the cert change, and publish refuses same-version drift (#982). Until now cert/meta.json had no `"users"`, so ladder-pr booted the kernel with its default user mode, and the published 2.47.0-6 was certified that way. cert-coverage.test.mjs's #819 allowlist names binutils for exactly that. With `"users": "enforce"` the specs run with the kernel's credentials enforced. The same specs passed under enforce in #960's cert review, on the cert kernel and on slicc-kernel 1.122.2.
