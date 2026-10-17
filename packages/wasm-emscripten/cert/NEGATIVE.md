# Negative proof (wasm-emscripten)

## 6.0.9-18: path resolution (#277)

`run-paths.mjs --expect old` against 6.0.9-17 is a `ci` entry: in an npm layout its em-config looks under `/shared/lib/node_modules`, which no package manager fills.

## 6.0.9-19: the companions' glue (homescoop#276, 2026-10-16)

`run-paths.mjs --layout flat` against the published 6.0.9-18 on slicc-kernel 1.61.0 (the cert kernel): FAIL, with `clang --version (24.0.0-12): rc=70`. The wasm-clang that 6.0.9-18 pins carries slicc-emscripten's unguarded Node-host runner, which runs a second main with no arguments wherever the worker exposes `process`, as kernels before 1.93.0 do. 6.0.9-19 pins wasm-clang 24.0.0-18 and wasm-binaryen 132.0.0-2 (#610, #693), whose glue stays out of a host that sets `noInitialRun`. Both `--version` calls exit 0 with nothing on stderr.

## 6.0.9-20: built from the 6.0.9 tag in CI (homescoop#859, #205, #538, #745; 2026-10-17)

- **Supply chain.** The published 6.0.9-19 is a repack whose root, 6.0.9-11, was an rsync of a local slicc-emscripten checkout: no provenance and no recorded commit. `repack-input.mjs` makes that INCOMPLETE. 6.0.9-20 fetches the emscripten 6.0.9 tag (4e422385, the emscripten_revision of emsdk's 6.0.9 release f04ea239) by sha256 and applies `patches/0001-0010`. They're 0001-0004, 0006 and 0007 as before, plus 0005, 0008, 0009 and 0010, recovered from the published tree. The patched tree reproduces the published one file for file. The shim objects are compiled in CI by that tree's emcc on emsdk 6.0.9's prebuilt clang and binaryen, which are sha256-pinned in `sources:`.
- **Tarball against 6.0.9-19.** The two differ in four ways:
  - the 8 `lib/slicc/*.o` objects and `slicc-fork.js` (today's `shims/slicc`);
  - new `AUTHORS` and `SECURITY.md` (#538; LICENSE cites them);
  - six upstream lint dotfiles under `system/lib` (`.clang-format`, `.clang-tidy`) that are no longer shipped;
  - `package.json` (version, `files`, the wasm-clang pin 24.0.0-21).

  Everything else is byte-identical.
- **`test/files.test.mjs` fails on 6.0.9-19:** `build.sh files entries name the tarball exactly` reports `Media (there: media)`. npm on Linux matches `files` case-sensitively, so a Linux pack of -19's list would drop the logos (#205). The package.json now says `media`, and all three file tests pass on 6.0.9-20.
- **By path (#745).** On 1.110.7, `run-paths.mjs` (flat) passes for 6.0.9-20: clang and wasm-opt run by path, and `emcc -v` reaches clang. On 1.61.0, the old cert kernel, `emcc -v` fails with `[Errno 45] Exec format error`.
