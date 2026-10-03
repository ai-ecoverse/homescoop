# wasm-emscripten 6.0.9-11

- Pins `@ai-ecoverse/wasm-clang@24.0.0-10`: one multi-call `llvm.wasm` behind the
  same LLVM_ROOT glue names (clang, clang++, wasm-ld, llvm-ar, llvm-nm,
  llvm-objcopy, llvm-strip, llvm-symbolizer…). No other change from 6.0.9-10.

## 6.0.9-10

- Depends on `@ai-ecoverse/emscripten-cache@6.0.9-3`.
- Weak `__syscall_getpid` / `__syscall_getppid` in default-linked
  `slicc_libc_gaps.c` (Module.sliccPid / Module.sliccPpid, fallbacks 42 / 1).
  `slicc_fork.c` keeps strong overrides for ASYNCIFY fork links.
- Ships `lib/slicc/slicc-fork.js`; adopts `Module.sliccPpid` next to `sliccPid`.
  Fork opt-in:
  `$SLICC_EM_LIBDIR/slicc_fork.o --js-library $SLICC_EM_LIBDIR/slicc-fork.js
  -sASYNCIFY -sASYNCIFY_STACK_SIZE=1048576
  -sEXPORTED_RUNTIME_METHODS=FS,ENV,callMain,sliccRunMain,sliccForkChild`.
  Without the exports, the runtime cannot drive main through the fork library
  (getpid stays at the library default) or resume a child.
- Musl `alltypes.h` keeps `__bits[128/sizeof(long)]`; slicc_signals.o stride 140.
