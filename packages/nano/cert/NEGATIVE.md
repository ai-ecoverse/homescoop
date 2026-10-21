# Negative proof (nano)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`.

## Empty wasm

With `bin/nano.wasm` truncated to 0 bytes, the checklist fails at the first
`nano` (slicc-kernel 1.23.0, Node entry; certified on 1.26.6):

```
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## Known-bad build: no terminal fallbacks

`build.sh` with `--with-fallbacks=dumb` instead of
`xterm-256color,xterm,vt100,dumb` (built locally, not committed): nano
cannot open the kernel's `xterm-256color` terminal, and the checklist fails:

```
+ 'Error opening terminal: xterm-256color.\n'
- 'Standard input is not a terminal\n'
```

## Spec non-vacuous

Every pty case must reach its prompts (`[ New File ]`, `Write to File:`,
`[ Wrote 2 lines ]`, `Save modified buffer?`) and exit by itself. The saved
files are compared byte for byte, including UTF-8 text, and the discard
case checks that the file did not change.

## 8.7.1-5: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs nano` (host-run's #908 check) fails on the published 8.7.1-4: 1 file(s) ship 1,497,146 bytes of DWARF.

The published 8.7.1-4 also has 13 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/nano.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

8.7.1-5 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 8.7.1-4 too; the negative is the #908 check.

## 8.7.1-6: nano -G lock files (homescoop#866; 2026-10-20)

`cert/locking.mjs`: wasm-nano 8.7.1-3, -4 and -5 link Emscripten's strong `getpwuid` stub, which never finds a user, so `nano -G` prints `[ Couldn't determine my identity for lock file ]` and writes no `.f.txt.swp` (#866's repro, slicc-kernel 1.110.5 and 1.26.6 under users enforce). On npm's 8.7.1-5 with slicc-kernel 1.132.1, `cert/locking.mjs` fails 2 of 5 assertions: the identity message, and no lock file. A local build of this branch with `$(homescoop_slicc_wrap_pwd)` passes, along with checklist.mjs, on slicc-kernel 1.132.1 under users enforce. The cert kernel moves there from 1.26.6, which has no users API for `addUser`.

## 8.7.1-7: shim drift (homescoop#1491; 2026-10-20)

8.7.1-7 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 8.7.1-6 in `THIRD-PARTY-NOTICES.md`, so this is a packaging bump. The package's own code is unchanged. `THIRD-PARTY-NOTICES.md` also gains the slicc-shims section that every wasm linking the shims now carries (homescoop#1388). The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
