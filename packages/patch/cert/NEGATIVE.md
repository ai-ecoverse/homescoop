# Negative proof (patch)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`. Runs on slicc-kernel 1.26.6
(Node entry).

## Known-bad build: the published 2.8.0

2.8.0 applies patches correctly, but it ships homescoop's Apache-2.0 text as
LICENSE (the committed stub, #123). The checklist fails on the package's own
files:

```
LICENSE is not GPL-3: "                                 Apache License\n   …Version 2.0, January 2004\n"
```

## Spec non-vacuous

Every case compares the exit status, stdout and stderr exactly, including
the `.rej` contents and the `.orig` backup.

## 2.8.0-4: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs patch` (host-run's #908 check) fails on the published 2.8.0-3: 1 file(s) ship 689,783 bytes of DWARF.

The published 2.8.0-3 also has 2 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/patch.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

2.8.0-4 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 2.8.0-3 too; the negative is the #908 check.

## 2.8.0-5: shim drift (homescoop#1491; 2026-10-20)

2.8.0-5 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 2.8.0-4 in `THIRD-PARTY-NOTICES.md`, `bin/patch` and `bin/patch.wasm`, so this is a packaging bump. The package's own code is unchanged. `THIRD-PARTY-NOTICES.md` also gains the slicc-shims section that every wasm linking the shims now carries (homescoop#1388). The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
