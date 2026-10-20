# Negative proof (wasm-emscripten)

## 6.0.9-18: path resolution (#277)

`run-paths.mjs --expect old` against 6.0.9-17 is a `ci` entry: in an npm layout its em-config looks under `/shared/lib/node_modules`, which no package manager fills.

## 6.0.9-19: the companions' glue (homescoop#276, 2026-10-16)

`run-paths.mjs --layout flat` against the published 6.0.9-18 on slicc-kernel 1.61.0 (the cert kernel): FAIL, with `clang --version (24.0.0-12): rc=70`. The wasm-clang that 6.0.9-18 pins carries slicc-emscripten's unguarded Node-host runner, which runs a second main with no arguments wherever the worker exposes `process`, as kernels before 1.93.0 do. 6.0.9-19 pins wasm-clang 24.0.0-18 and wasm-binaryen 132.0.0-2 (#610, #693), whose glue stays out of a host that sets `noInitialRun`. Both `--version` calls exit 0 with nothing on stderr.

## 6.0.9-20: built from the 6.0.9 tag in CI (homescoop#859, #205, #538, #745; 2026-10-17)

- **Supply chain.** The published 6.0.9-19 is a repack whose root, 6.0.9-11, was an rsync of a local slicc-emscripten checkout: no provenance and no recorded commit. `repack-input.mjs` makes that INCOMPLETE. 6.0.9-20 fetches the emscripten 6.0.9 tag (4e422385, the emscripten_revision of emsdk's 6.0.9 release f04ea239) by sha256 and applies `patches/0001-0012`. They're 0001-0004, 0006 and 0007 as before, plus 0005, 0008, 0009 and 0010, recovered from the published tree, and the new 0011 and 0012. Through 0010 the patched tree reproduces the published one file for file. 0011 adds `-ffile-prefix-map=<cache>=/emsdk/cache` and `<llvm root>=/emsdk/llvm` to the system library flags: without them the DWARF in every embuilder library names the cache's sysroot/include and clang's resource headers, both build paths, and emscripten-cache's two CI builds differed in 45 of 50 archives. The shim objects are compiled in CI by that tree's emcc on emsdk 6.0.9's prebuilt clang and binaryen, which `scripts/emscripten-tree.sh` pins by sha256.
- **Tarball against 6.0.9-19.** The two differ in four ways:
  - the 8 `lib/slicc/*.o` objects and `slicc-fork.js` (today's `shims/slicc`);
  - new `AUTHORS` and `SECURITY.md` (#538; LICENSE cites them);
  - six upstream lint dotfiles under `system/lib` (`.clang-format`, `.clang-tidy`) that are no longer shipped;
  - `package.json` (version, `files`, the wasm-clang pin 24.0.0-21).

  Everything else is byte-identical.
- **`test/files.test.mjs` fails on 6.0.9-19:** `build.sh files entries name the tarball exactly` reports `Media (there: media)`. npm on Linux matches `files` case-sensitively, so a Linux pack of -19's list would drop the logos (#205). The package.json now says `media`, and all three file tests pass on 6.0.9-20.
- **By path (#745).** On 1.110.7, `run-paths.mjs` (flat) passes for 6.0.9-20: clang and wasm-opt run by path, and `emcc -v` reaches clang. On 1.61.0, the old cert kernel, `emcc -v` fails with `[Errno 45] Exec format error`.

## 0012: the JS halves of today's shims (homescoop#1056)

Building `lib/slicc` from today's `shims/slicc` broke the default link. `slicc_libc_gaps.o` now imports `env.__syscall_uname`, but 0005's defaults did not add `slicc-uname.js`, so any program calling `uname()` failed:

```text
error: undefined symbol: __syscall_uname
```

6.0.9-19's objects have no such import. 0012 ships `slicc-writev.js`, `slicc-linkat.js` and `slicc-uname.js` in `lib/slicc/`, and adds them as `--js-library` defaults. The default link also gets `homescoop_slicc_keep_exports`'s `-u slicc_raise`, `slicc_sig_mask`, `slicc_sigpipe` and `slicc_cred_euid`, plus `--wrap=raise`, so it matches `homescoop_em_cli_ldflags`. build.sh's PRESTAGE now links a program that calls `uname`, `link`, `getuid`, `getrlimit` and `raise` with the packaged defaults, and runs it under node: `uname 0 Emscripten`, and the SIGUSR1 handler runs.


## 6.0.9-21: the companion pins and the -Werror link (homescoop#1028, #1069; 2026-10-18)

`test/pinned-cache.mjs` runs emscripten-cache's cert on the exact emscripten-cache version a tarball pins. The published 6.0.9-20 pins 6.0.9-3, which fails it:

```text
AssertionError: libraries name a build path in their DWARF (patch 0011 maps the cache and the llvm root): libGL-getprocaddr: /Users/trieloff/Developer/ai-ecoverse/slicc-emscripten/cache/sysroot/include | …
FAIL the pinned emscripten-cache 6.0.9-3 fails its cert against this tree
```

With that row out of the way, its `libc.a` still lacks `epoll_create1`, `ppoll` and `__syscall_pipe`, which the 6.0.9 headers declare. 6.0.9-21 pins 6.0.9-4, the CI build from the same tree, and passes. wasm-binaryen moves from 132.0.0-2 to 132.0.0-3, the CI build of binaryen d03c25ea, which has the credential library.

On 6.0.9-20 a default link that pulls in `lib/slicc/slicc-linkat.js` warns `signature redefinition for: __syscall_linkat__sig`, so `-Werror` links fail (#1069). Emscripten's `libsigs.js` already has the same `'iipipi'`. 6.0.9-21 ships the file without that line, and PRESTAGE links `calls.c` with `-Werror` and requires the warning to be absent.

## 6.0.9-22: the inherited-ignore and flock shims (homescoop#973, #947, via #960; 2026-10-18)

6.0.9-22 compiles `lib/slicc` from #960's `shims/slicc`. `slicc_signals.o` gets the `constructor(101)` that seeds `SIG_IGN` from `sliccKernel.sigInherited()`. `slicc_libc_gaps.o` gets the strong `flock()` through `env.__syscall_flock`. Both are no-ops on kernels without slicc-kernel#967 and #968. On the published 6.0.9-21, `test/files.test.mjs` fails:

```text
AssertionError: slicc_signals.o has no slicc_sig_inherited_js (the #973 constructor)
```

The emscripten tree, the patches and the pins are unchanged from 6.0.9-21.

## 6.0.9-23: the CI-built wasm-clang and wasm-binaryen (homescoop#859; 2026-10-19)

`test/companions.mjs` packs the exact companions a tarball pins. It fails on the published 6.0.9-22:

```text
FAIL wasm-clang 24.0.0-21 ships no THIRD-PARTY-NOTICES.md; wasm-binaryen 132.0.0-3's wasm-opt.wasm does not import slicc_sig_inherited_js
```

24.0.0-21 is the last wasm-clang relinked from a local slicc-emscripten tree. 132.0.0-3 predates #960's inherited-ignore shim. 6.0.9-23 pins wasm-clang 24.0.0-22 (stage F, built from llvm-emscripten) and wasm-binaryen 132.0.0-4, and passes. The emscripten tree, the patches and the lib/slicc objects are unchanged from 6.0.9-22.

The same release moves wasix-python from the exact 3.14.2-16 to the range `>=3.15.0-2 <3.15.1`. That's the python3.15 flip; check-exact-pins now allows wasm-emscripten that range, as it allows py-*. It also gains `engines: slicc-kernel >=1.122.3`, because wasix-python 3.15.0-2 refuses older kernels. On the old cert kernel 1.110.7, run-paths fails at once: `python3: @ai-ecoverse/wasix-python@3.15.0-2 needs slicc-kernel >=1.122.3`. So the cert kernel moves to 1.132.0, where em-config, em-ensure-cache and `emcc -v` run through CPython 3.15 in the flat and pnpm layouts.

## 6.0.9-24: a sorted musl walk (homescoop#1328; 2026-10-20)

The new `test/files.test.mjs` row fails on the published 6.0.9-23: its `tools/system_libs.py` walks musl in filesystem order. Through embuilder that made libc's `_Exit.o` and `_exit.o` member names depend on the host (emscripten-cache's NEGATIVE.md). Patch 0013 sorts the walk. The other change is `scripts/emscripten-tree.sh`'s exact acorn pins. Apart from those, 6.0.9-24 equals -23.
