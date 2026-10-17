# Negative proof (wasm-binaryen)

## 132.0.0-2: the glue's Node-host runner (homescoop#276, 2026-10-16)

`node-entry.mjs` against the published 132.0.0-1 on slicc-kernel 1.92.0 (Node entry, users enforce): FAIL at once, with `bin/wasm-opt: the Node-host runner has no noInitialRun guard (homescoop#276)`. With that check switched off and the glue left as shipped, every tool still exits 0 with its version, but the runner runs a second main with no arguments. `wasm-opt --version` prints `warning: no passes specified, not doing any work` and `warning: no output file specified, not emitting output` on stderr, `wasm-metadce --version` prints `Fatal: no graph file provided.`, and `wasm-emscripten-finalize --version` prints `Fatal: Need to specify an infile`. The spec then fails, `wasm-opt --version printed on stderr`.

From slicc-kernel 1.93.0 the kernel's Node lockdown hides `process` from the worker, so the runner can't fire there. wasm-binaryen declares no slicc-kernel floor, and wasm-clang's cc, which drives wasm-opt, declares 1.44.0. 132.0.0-2 passes on 1.92.0 and on 1.100.4.

## 132.0.0-3: built in CI from binaryen d03c25ea (homescoop#859, #459; 2026-10-17)

- **Supply chain.** The published 132.0.0-2 is a repack of 132.0.0-1, which relinked objects from a local `slicc-emscripten/build/binaryen-wasm` (2026-09-22, no provenance). `repack-input.mjs` makes that INCOMPLETE. 132.0.0-3 fetches binaryen `d03c25ea` by sha256 and runs emcmake (Release, `BUILD_EMSCRIPTEN_TOOLS_ONLY`, the default LTO) with the patched emscripten 6.0.9 tree on emsdk 6.0.9's prebuilt compilers. Each tool is then relinked against today's `shims/slicc` and the credential library.
- **`node-entry.mjs` fails on the published 132.0.0-2:**
  ```text
  AssertionError: bin/wasm-opt.wasm lacks the slicc credential library (import slicc_cred_js, export slicc_cred_euid; homescoop#459)
  ```
  `check-slicc-cred.mjs` says the same about all 8 tools: none of them names `slicc_cred_js`, so under users the kernel treats every file they write as 1000:1000. 132.0.0-3 passes on 1.110.7 and on the 1.92.0 row.
- **Link.** The link is `-O3 -g`. `-g` keeps the wasm import and export names, which `check-slicc-cred` needs; at `-g2` or `-O3` alone emcc minifies them, and `-sASSERTIONS=1` trips "shell environment detected" in the kernel's worker. The DWARF and the name section are then stripped with `llvm-objcopy`, so -3, like -2, has no name section. Sizes: wasm-opt.wasm is 11.1 MB of code (-2: 9.6 MB). The tarball is 19 MB (-2: 17 MB), 82 MB unpacked (-2: 74 MB).
- **Build paths.** Binaryen keeps its assertions in Release (`BYN_ENABLE_ASSERTIONS`), so `__FILE__` put the absolute work-dir source path into each wasm's data. build.sh passes `-ffile-prefix-map` for the source and build dirs. build.sh and `node-entry.mjs` both fail on any `/home/`, `/Users/`, `/__w/` or `/private/var/` in a tool wasm. Two local builds in different work dirs gave byte-identical tarballs.
