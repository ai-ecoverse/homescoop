# Negative proof (diffutils)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`. Runs on slicc-kernel 1.26.6
(Node entry).

## Known-bad build: the published 3.12.0

3.12.0 linked the `cli` shim profile as plain LDFLAGS (no fork, and not
whole-archive), so `execve`/`posix_spawn` were Emscripten's stubs. diff and
cmp work, but the checklist fails at sdiff, and diff3 fails the same way:

```
sdiff -w 30 x y: rc=2 stderr=sdiff: diff: Exec format error
diff3: fork: Function not implemented
```

3.12.0-1 links the `fork` profile (Asyncify) through
`homescoop_slicc_link_archive`, so both run diff as a child.

## Spec non-vacuous

Every case compares the exit status and the exact output against GNU
diffutils 3.12 run on the host.

## 3.12.0-3: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs diffutils` (host-run's #908 check) fails on the published 3.12.0-2: 4 file(s) ship 1,990,081 bytes of DWARF.

The published 3.12.0-2 also has 8 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/sdiff.wasm, bin/diff3.wasm, bin/diff.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

3.12.0-3 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 3.12.0-2 too; the negative is the #908 check.

## 3.12.0-4: shim drift (homescoop#1491; 2026-10-20)

3.12.0-4 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 3.12.0-3 in `THIRD-PARTY-NOTICES.md`, `bin/cmp`, `bin/diff`, `bin/diff.wasm`, `bin/diff3` and more, so this is a packaging bump. The package's own code is unchanged. `THIRD-PARTY-NOTICES.md` also gains the slicc-shims section that every wasm linking the shims now carries (homescoop#1388). The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
