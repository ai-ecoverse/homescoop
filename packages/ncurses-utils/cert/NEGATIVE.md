# Negative proof (wasm-ncurses-utils)

## 6.5.0-4: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

6.5.0-4 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 6.5.0-3 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 6.5.0-3 as well. The build also gets #908's prefix maps and DWARF strip.

## 6.5.0-5: no build directory in the terminfo search list (homescoop#1009; 2026-10-20)

npm's 6.5.0-4 fails the new build.sh guard: `grep -laF /tmp/homescoop-work` matches `bin/clear.wasm`, `bin/tput.wasm` and `bin/tset.wasm`, whose `strings` list `/tmp/homescoop-work/ncurses-utils/wasm-prefix/share/terminfo` before `/usr/share/terminfo`. The 6.5.0-5 build has only `/usr/share/terminfo` (and `%s/.terminfo`). checklist.mjs passes on its cert kernel under users enforce.

## 6.5.0-6: shim drift (homescoop#1491; 2026-10-21)

6.5.0-6 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 6.5.0-5 in `bin/clear`, `bin/tput` and `bin/tset`, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
