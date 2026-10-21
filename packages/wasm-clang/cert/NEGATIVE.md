# Negative proof (wasm-clang)

## 24.0.0-14: negative 24.0.0-13 (wasix-sysroot -27)

`R28_KERNEL_MASK=1 R28_WINDOW=1 node packages/wasm-clang/test/run-cc.mjs --tarball @ai-ecoverse/wasm-clang@24.0.0-13 --layout flat --probes r28,r28w` on slicc-kernel 1.93.0: `wasixcc r28w.c: rc=1`, `wasm-ld: error: … undefined symbol: ppoll` (-27 has no ppoll, and no kernel masks).

## 24.0.0-15: the glue's Node-host runner and cc's Asyncify check (homescoop#276, #451; 2026-10-16)

`run-cc.mjs` (current mode) against the published 24.0.0-14:

- **Glue (#276).** It fails at once: `glue whose Node-host runner fires in slicc-kernel's Node process worker (no noInitialRun guard, homescoop#276): clang, clang++, ld.lld, lld, llvm, llvm-ar, llvm-nm, llvm-objcopy, llvm-ranlib, llvm-strip, llvm-symbolizer, wasm-ld`. With that check switched off and the glue left as shipped, `wasixcc --version` gives rc 70, `clang: error: no input files`, on slicc-kernel 1.61.0, 1.77.0, 1.83.0, 1.88.0, 1.91.0 and 1.92.0. It passes on 1.93.0 and 1.102.6: from 1.93.0 the kernel's Node lockdown hides `process` from the worker's scope, so the runner never fires there. wasm-clang's engines floor is 1.44.0, so the runner still fires for users on 1.44.0-1.92.0. A `ci` entry runs r18 on 1.92.0 for that reason. 24.0.0-15 passes there, and on 1.83.0 it passes all of r18, r21, r24, r24link, r26 and r27 with the glue as shipped.
- **Asyncify (#451).** With the glue cut off as before (the old harness) and no grep in the realm (wasm-grep dropped from `needs`), the flat-layout r28 build on 1.93.0 fails: `r28.wasm: … fork imports yes, asyncify no` and `cc must asyncify exactly the modules that import proc_fork/stack_checkpoint/stack_restore`. -14's driver grepped for the import names, and with grep missing the check failed silently. 24.0.0-15's driver reads the import section with od, and its r28 and r28w come out asyncified and pass.

## 24.0.0-16: a.out and -oFILE (homescoop#692, 2026-10-16)

`run-cc.mjs` (flat, R28) against the published 24.0.0-15: FAIL, `wasixcc -O2 r28.c → a.out: asyncify no`. The driver took the output path only from a separate `-o FILE`, so a link without `-o`, or with the joined `-oFILE`, skipped the whole post-link step, the import check and `WASIXCC_ASYNCIFY` included. 24.0.0-16 asyncifies both, and `WASIXCC_ASYNCIFY=0` still skips the step.

## 24.0.0-17: calls that write no program (homescoop#710, #711; 2026-10-16)

`run-cc.mjs` (flat, R28) against the published 24.0.0-16: FAIL with `wasixcc -v next to an asyncified a.out: rc=1`. The driver added its link libraries to every call that wasn't compile-only, so `-v` with no inputs ran a link of nothing, and the failed link removed the a.out (#711, the same on -15). With `-v` left out it fails again, at `wasixcc -fsyntax-only r18.c next to an asyncified a.out: rc=1`: -16's a.out default ran the Asyncify step over the old a.out (`asyncify_start_unwind already exists`, #710). 24.0.0-17 adds link libraries only when there are link inputs, and post-links only real links. `--version`, `-v`, `-fsyntax-only`, `-###` and a header-only input all exit 0 and leave an asyncified a.out and a non-wasm one unchanged.

## 24.0.0-18: response files, PCHs, -Xlinker -o (homescoop#721, #722; 2026-10-16)

`run-cc.mjs` (flat, R28) against the published 24.0.0-17: FAIL with `wasixcc -O2 r28.c -Xlinker -o -Xlinker xl.wasm → a.out: asyncify no`, because the driver took the `-Xlinker` that follows the linker's `-o` as the output. With that case left out it fails again, at `wasixcc -v -B /tmp next to an asyncified a.out: rc=1`: the `-B` value counted as a link input, so `-v` ran a link of nothing that removed the a.out (#711). #721's and #722's own repros (`cc @rsp` with the `-o` inside the response file, and `cc -x c-header x.h -o x.pch`) are in the same block. 24.0.0-18 passes all of them.

## 24.0.0-19: same-bytes relinks, quoted and nested response files (Codex on #725, 2026-10-16)

`run-cc.mjs` (flat, R28) against the published 24.0.0-18: FAIL, `wasixcc -O2 r28.c -o r28n.wasm → r28n.wasm: asyncify no`. The link after a `WASIXCC_ASYNCIFY=0` run rewrote the same bytes, and -18 took an unchanged cksum to mean "not written". With that case left out it fails again, at `wasixcc -O2 @q.rsp → sp ace.wasm: asyncify no`: -18 split response files on blanks, so it never saw the quoted output. 24.0.0-19 passes both, and the nested `@outer.rsp` too.

## 24.0.0-20: braces in response files, the marker file (homescoop#754, #755; 2026-10-16)

`run-cc.mjs` (flat, R28) against the published 24.0.0-19: FAIL, `wasixcc -O2 @brace.rsp → br{a,b}.wasm: asyncify no`. -19's `eval` brace-expanded the file's words, so the driver looked for `bra.wasm`. -19 also left a `wasix-out.*` marker in TMPDIR whenever the frontend failed, because `set -e` ended the driver before its cleanup (#754). 24.0.0-20 passes both checks.

## 24.0.0-21: clang's tokenizer for response files (homescoop#769; 2026-10-16)

`run-cc.mjs` (flat, R28) against the published 24.0.0-20: FAIL, `wasixcc -O2 @bq.rsp → q {x}.wasm: asyncify no`. -20 split any file with `{ } ~ $ …` on blanks, so the driver read `-o "q` and `{x}.wasm"` and skipped Asyncify while clang wrote `q {x}.wasm`. @dq.rsp (`$` next to a quoted `-o`) failed on -19 and -20 alike. 24.0.0-21 passes all four new response files, @long.rsp included.

## 24.0.0-22: built in CI from llvm-emscripten, and legacy EH (homescoop#859, #965; 2026-10-18)

- **Supply chain.** The published 24.0.0-21 is a repack of 24.0.0-11. That release relinked objects from a local `slicc-emscripten/build/llvm-wasm`, with no provenance and no recorded commit; `repack-input.mjs` makes that INCOMPLETE. 24.0.0-22 fetches `@ai-ecoverse/llvm-emscripten` 24.0.0-2 by sha256. That package is llvm-project b158b0ae compiled in CI by the patched emscripten 6.0.9 tree (#859 stage E). 24.0.0-22 links the six tools and `multicall.cpp` with the same tree against today's `shims/slicc`. The builtins come from the pinned wasix-sysroot tarball, not a staged checkout. The four signal-ABI recompiles are gone, because the objects are compiled against the 128-byte sigset_t.
- **Legacy EH (#965).** `test/cxx-eh.mjs --expect old` runs the published 24.0.0-21 on wasix-sysroot 2025.9.30-38. The legacy PIC tree always fails. The non-PIC legacy tree fails on a mac's node 26 but runs on the CI runner, so the negative requires only the ehpic failure. The mac run:

  ```text
  sysroot-eh cxx-eh.wasm ran: "rc=126" bash: line 1: /home/sysroot-eh.eh.wasm: I/O error
  sysroot-ehpic cxx-eh.cpp: rc=1 … wasix-driver: wasm-opt --asyncify failed
  ```

  Its driver passes `--wasm-use-legacy-eh=false` in every mode. That's exnref code against the legacy-EH runtimes -33+ ship in sysroot-eh/ehpic, and binaryen's Asyncify can't flatten it. 24.0.0-22 passes all four trees.
- **Size.** bin/llvm.wasm is 75 MB, as -21's 74.8 MB. The tarball is 27 MB.
- **Executable path.** With llvm-emscripten 24.0.0-1, `sys::fs::getMainExecutable` returned "" under Emscripten, through the dladdr branch. clang then printed `InstalledDir:` empty and spawned `""` for `-cc1`, and every compile in slicc-kernel failed with `posix_spawn failed: No such file or directory`. 24.0.0-2 carries the patch that resolves argv[0] through PATH (manifest `llvm_patches`), and build.sh refuses an input without it. run-cc.mjs passes again: clang shows `InstalledDir: /usr/bin`, as -21 does.
- **Notices.** -21 ships no THIRD-PARTY-NOTICES.md, though its llvm.wasm carries LLVM Support's regex, BLAKE3 and xxHash code. check-package-meta now refuses that. -22 ships Emscripten's runtime notices and llvm-emscripten's LLVM Support notices.
- **Reproducible.** Two local builds in different work dirs gave byte-identical tarballs.

## 24.0.0-23: deep nesting and the EH-encoding negative (homescoop#1248, #1229; 2026-10-20)

- **#1248:** `test/cxx-eh.mjs` (current mode) against the published 24.0.0-22 fails at the new deep-nesting row:

  ```text
  FAIL AssertionError: cc -c p2000.c: rc=70 after 506 ms RuntimeError: divide by zero
  ```

  clang's parser recurses on the engine's own stack, and in slicc's realm that runs out near 1500 levels. clang's stack guard measures Emscripten's separate 8 MB stack, so it never warns. 24.0.0-21 hung instead. The cc driver now caps `-fbracket-depth` at 1024 (before the caller's flags, so a caller's own value wins). 2000 levels of parentheses or blocks now give clang's `bracket nesting level exceeded maximum of 1024`, rc 1, and 1000 still compiles.
- **#1229:** with -22 the row's code is unchanged, so there's no package negative. The test now checks the encoding of each tree's program by validating it with the other EH feature off, so the `--expect old` row fails -21 in both legacy trees on any engine. Before, it passed sysroot-eh on Node 24, which runs mixed modules.

## 24.0.0-24: shim drift (homescoop#1491; 2026-10-20)

24.0.0-24 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 24.0.0-23 in `bin/clang`, `bin/clang++`, `bin/ld.lld`, `bin/lld`, `bin/llvm` and more, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
