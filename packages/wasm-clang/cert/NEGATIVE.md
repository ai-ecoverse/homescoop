# Negative proof (wasm-clang)

## 24.0.0-14: negative 24.0.0-13 (wasix-sysroot -27)

`R28_KERNEL_MASK=1 R28_WINDOW=1 node packages/wasm-clang/test/run-cc.mjs --tarball @ai-ecoverse/wasm-clang@24.0.0-13 --layout flat --probes r28,r28w` on slicc-kernel 1.93.0: `wasixcc r28w.c: rc=1`, `wasm-ld: error: … undefined symbol: ppoll` (-27 has no ppoll, and no kernel masks).

## 24.0.0-15: the glue's Node-host runner and cc's Asyncify check (homescoop#276, #451; 2026-10-16)

`run-cc.mjs` (current mode) against the published 24.0.0-14:

- **Glue (#276).** It fails at once: `glue whose Node-host runner fires in slicc-kernel's Node process worker (no noInitialRun guard, homescoop#276): clang, clang++, ld.lld, lld, llvm, llvm-ar, llvm-nm, llvm-objcopy, llvm-ranlib, llvm-strip, llvm-symbolizer, wasm-ld`. With that check switched off and the glue left as shipped, `wasixcc --version` gives rc 70, `clang: error: no input files`, on slicc-kernel 1.61.0, 1.77.0, 1.83.0, 1.88.0, 1.91.0 and 1.92.0. It passes on 1.93.0 and 1.102.6: from 1.93.0 the kernel's Node lockdown hides `process` from the worker's scope, so the runner never fires there. wasm-clang's engines floor is 1.44.0, so the runner still fires for users on 1.44.0-1.92.0. A `ci` entry runs r18 on 1.92.0 for that reason. 24.0.0-15 passes there, and on 1.83.0 it passes all of r18, r21, r24, r24link, r26 and r27 with the glue as shipped.
- **Asyncify (#451).** With the glue cut off as before (the old harness) and no grep in the realm (wasm-grep dropped from `needs`), the flat-layout r28 build on 1.93.0 fails: `r28.wasm: … fork imports yes, asyncify no` and `cc must asyncify exactly the modules that import proc_fork/stack_checkpoint/stack_restore`. -14's driver grepped for the import names, and with grep missing the check failed silently. 24.0.0-15's driver reads the import section with od, and its r28 and r28w come out asyncified and pass.
