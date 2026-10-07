# Negative proof (xxd)

**Date:** 2026-10-07  
**Method:** `node scripts/browser-cert/prove-negative.mjs --package xxd --tarball <good.tgz>`  
(empties `bin/*.wasm` and expects cert failure)

**Result:** FAIL as required — `WebAssembly.compile(): BufferSource argument is empty`; prove-negative exited 0.

**Good tarball used:** published npm package for this recipe (see `npm view @ai-ecoverse/wasm-xxd version`).
