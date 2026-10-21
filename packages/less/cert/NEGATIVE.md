# Negative proof (less)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`.

## Empty wasm

With `bin/less.wasm` truncated to 0 bytes, the checklist fails at the first
`less` (slicc-kernel 1.23.0, Node entry; certified on 1.26.6):

```
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## Known-bad build: no terminal fallbacks

`build.sh` with `--with-fallbacks=dumb` instead of
`xterm-256color,xterm,vt100,dumb` (built locally, not committed): ncurses
then has no terminfo for the kernel's `TERM=xterm-256color`, and the first
pty case fails (slicc-kernel 1.23.0, Node entry; certified on 1.26.6):

```
-F -X status=null out="WARNING: terminal is not fully functional\r\nPress RETURN to continue "
```

## Spec non-vacuous

The pty cases compare the rendered text (escape sequences stripped) and the
exact `-N`, `-S` and highlight sequences. Each must exit by itself (`-F`),
or on `q` after the expected prompt; a hang is reported as `status=null`
with the output so far. Secure mode is asserted through the refusal
message, not by its absence.

## 668.0.0-5: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

668.0.0-5 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 668.0.0-4 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 668.0.0-4 as well. The build also gets #908's prefix maps and DWARF strip.

## 668.0.0-6: shim drift (homescoop#1491; 2026-10-20)

668.0.0-6 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 668.0.0-5 in `THIRD-PARTY-NOTICES.md` and `bin/less`, so this is a packaging bump. The package's own code is unchanged. `THIRD-PARTY-NOTICES.md` also gains the slicc-shims section that every wasm linking the shims now carries (homescoop#1388). The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
