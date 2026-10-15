# Negative proof (wasm-clang)

## 24.0.0-14: negative 24.0.0-13 (wasix-sysroot -27)

`R28_KERNEL_MASK=1 R28_WINDOW=1 node packages/wasm-clang/test/run-cc.mjs --tarball @ai-ecoverse/wasm-clang@24.0.0-13 --layout flat --probes r28,r28w` on slicc-kernel 1.93.0: `wasixcc r28w.c: rc=1`, `wasm-ld: error: … undefined symbol: ppoll` (-27 has no ppoll, and no kernel masks).
