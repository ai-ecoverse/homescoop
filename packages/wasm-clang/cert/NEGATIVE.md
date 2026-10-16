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
