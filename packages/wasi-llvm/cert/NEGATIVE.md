
## 21.1.8-2: LLVM Support's notices (homescoop#1046, 2026-10-19)

The published 21.1.8-1 against 21.1.8-2's `cert/check.mjs` (local, macOS, wasi-sdk 34): **FAIL, 1 check.** Its `lib/libLLVMSupport.a` carries `regcomp.c.o`, `blake3.c.o` and `xxhash.cpp.o`, but the package ships only `LICENSE` (LLVM's LICENSE.TXT): there's no `THIRD-PARTY-NOTICES.md` and no `share/licenses/llvm-support`. Every other check passes as before, including the IRBuilder, codegen and `lld::wasm::link` smoke. `check-package-meta.mjs`'s LLVM Support guard (#1155) refuses the same archive without the notices.
