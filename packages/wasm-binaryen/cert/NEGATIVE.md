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

## 132.0.0-4: the inherited-ignore and flock shims (homescoop#973, #947, via #960; 2026-10-18)

132.0.0-4 relinks the 8 tools against #960's `shims/slicc`: the `SIG_IGN` seed from `sliccKernel.sigInherited()` and the strong `flock()`. On the published 132.0.0-3, `node-entry.mjs` fails:

```text
AssertionError: bin/wasm-opt.wasm lacks shims/slicc's inherited-ignore seed (import slicc_sig_inherited_js, homescoop#973)
```

Binaryen d03c25ea and the link flags are unchanged.

## 132.0.0-5: notices (homescoop#1038, #844; 2026-10-20)

`node-entry.mjs` fails on the published 132.0.0-4:

```text
AssertionError: THIRD-PARTY-NOTICES.md lacks the Emscripten 6.0.9 notice (homescoop#1038, #844)
```

132.0.0-4 ships only binaryen's LICENSE. 132.0.0-5 adds `THIRD-PARTY-NOTICES.md` with the Emscripten runtime's notices and FP16's MIT licence. binaryen's `third_party/llvm-project` is Apache-2.0 WITH LLVM-exception, which waives the notice for compiled forms. The tools are rebuilt with the same source and flags.

## 132.0.0-6: shim drift (homescoop#1491; 2026-10-21)

132.0.0-6 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only (not true of this package: its link didn't name slicc-env.js until 132.0.0-7, #1530), and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 132.0.0-5 in `bin/wasm-as`, `bin/wasm-as.wasm`, `bin/wasm-ctor-eval`, `bin/wasm-dis`, `bin/wasm-dis.wasm` and more, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.

## 132.0.0-7: slicc-env.js, the shims notice and the package patches (homescoop#1530, #1534; 2026-10-22)

`node-entry.mjs` fails on the published 132.0.0-6:

```text
AssertionError [ERR_ASSERTION]: bin/wasm-opt: Emscripten's getEnvStrings placeholders ('USER': 'web_user') instead of shims/slicc/slicc-env.js, so env -i leaves USER=web_user, HOME=/home/web_user and PATH=/ (homescoop#1530)
```

| check | 132.0.0-6 | 132.0.0-7 |
|---|---|---|
| each of the 8 glues: `'USER': 'web_user'` placeholder (#1530) | present | absent; build.sh fails the link if it comes back |
| each glue: slicc-env.js's `ENV[x] !== undefined` body (#1530) | absent | present |
| each glue: libfs `lookupPath` loop `nlinks <= 40` (package-patches 0014) | `nlinks < 40` | `nlinks <= 40` |
| `THIRD-PARTY-NOTICES.md`: `## homescoop: the slicc shims (shims/slicc, Apache-2.0)` (#1534) | missing | present, with the Apache-2.0 text |
| `scripts/test/shim-notice.test.mjs` | `wasm-binaryen` on `KNOWN_WITHOUT_SHIM_NOTICE` (closed #844) | entry gone; the package guard fails if the section goes missing |

- **#1530, the cause:** build.sh passes its own `--js-library` list, which named slicc-writev.js, slicc-linkat.js and slicc-uname.js but not `shims/slicc/slicc-env.js`, so Emscripten's stock `getEnvStrings` filled in its placeholders. The -6 entry above claimed slicc-env.js for this package; it did not apply. The link now adds slicc-env.js itself.
- **#1534, the cause:** build.sh compiles the shims itself, outside `homescoop_slicc_archive`, so no shims section was written. build.sh now calls `homescoop_notice_slicc_shims`.
- **Package patches:** build.sh now applies `packages/wasm-emscripten/package-patches/*.patch` to the emscripten-tree.sh tree, as wasm-emscripten's build.sh does for its host emcc, and the recipe lists them as inputs. 0014 makes the glue's file system follow `SYMLOOP_MAX` (40) consecutive symlinks instead of 39. 0015 adds slicc-env.js to link.py's default slicc link, which is a no-op here (the explicit `--js-library` list already has it).
