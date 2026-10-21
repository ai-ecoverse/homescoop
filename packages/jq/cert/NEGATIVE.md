# Negative proof (jq)

**Date:** 2026-10-07  
No SLICC patches on this package.

## Empty wasm

`prove-negative.mjs --package jq` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/basic.mjs` asserts `jq -n '1+1'` stdout is exactly `2\n` and that invalid
JSON exits non-zero. A build that always printed `0\n` or accepted bad JSON
would fail those asserts (covered by the positive assertions themselves).

## 1.8.2-4: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs jq` (host-run's #908 check) fails on the published 1.8.2-3: 1 file(s) ship 2,001,053 bytes of DWARF.

The published 1.8.2-3 also has 2 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/jq.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

1.8.2-4 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 1.8.2-3 too; the negative is the #908 check.

## 1.8.2-5: shim drift (homescoop#1491; 2026-10-20)

1.8.2-5 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 1.8.2-4 in `THIRD-PARTY-NOTICES.md` and `bin/jq`, so this is a packaging bump. The package's own code is unchanged. `THIRD-PARTY-NOTICES.md` also gains the slicc-shims section that every wasm linking the shims now carries (homescoop#1388). The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
