# Negative proof (util-linux)

**Date:** 2026-10-16, slicc-kernel 1.102.6 `--users enforce`.

- `prove-negative.mjs --package util-linux --spec users.mjs --users enforce`
  → FAIL (`WebAssembly.compile(): BufferSource argument is empty`; all six
  `bin/*.wasm` emptied).
- `@ai-ecoverse/wasm-util-linux@2.42.4-1` (no slicc credentials) passes
  users.mjs on 1.102.6 as well: the kernel refuses the opens itself. The spec
  guards the behaviour; host-run's `check-slicc-cred.mjs` guards the link.
  2.42.4-1 fails glue-by-path (0644 `bin/colrm`, `EACCES`).

## 2.42.4-4: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

2.42.4-4 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 2.42.4-3 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 2.42.4-3 as well. The build also gets #908's prefix maps and DWARF strip.

## 2.42.4-5: flock (homescoop#977; 2026-10-20)

- **2.42.4-4** has no `flock` command, so `cert/flock.mjs` can't run any of its rows.
- **While developing the patch:** with `gettime_monotonic()` (`CLOCK_MONOTONIC_RAW`, which fails under Emscripten), the `-w` deadline never passed. `flock -w 1` then got the lock at about 2 s, after the holder ended, with rc 0, and the spec failed. The patch uses `clock_gettime(CLOCK_MONOTONIC)`.
- **This build on slicc-kernel 1.102.6** fails 5 of 12 assertions, starting with `flock -n` getting a held lock, because that kernel has no flock table. On 1.132.1 it passes along with checklist.mjs and users.mjs, under users enforce.

## 2.42.4-6: shim drift (homescoop#1491; 2026-10-21)

2.42.4-6 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 2.42.4-5 in `bin/colrm`, `bin/colrm.wasm`, `bin/column`, `bin/column.wasm`, `bin/flock` and more, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.

## 2.42.4-7: flock -F, flock --verbose, program-source notices (homescoop#1465, #1500, #1466; 2026-10-21)

Run on slicc-kernel 1.132.1 `--users enforce`, against the published `@ai-ecoverse/wasm-util-linux@2.42.4-6` (npm latest):

- `run.mjs --package util-linux --tarball wasm-util-linux-2.42.4-6.tgz --spec flock.mjs` → FAIL, 6 of 21 assertions. `flock -F /tmp/l bash -c 'exit 7'` is rc 69 (`flock: failed to execute bash: Exec format error`), `flock -F /tmp/l -c 'echo f'` is rc 69 with no output, the `flock -F -x /tmp/l sleep 3` holder fails at once so `flock -n` gets the lock (rc 0, not 1), and `flock --verbose` reports `0.000000` seconds after a wait of about 2.5 s (#1465, #1468, #1500).
- `--spec licence.mjs` → FAIL: `THIRD-PARTY-NOTICES.md` lacks `sys-utils/flock.c`, `Copyright 2003-2005 H. Peter Anvin - All Rights Reserved`, the MIT permission sentence, and the getopt.c, column.c, rev.c, colrm.c and look.c holder lines (#1466, #1469).
- The 2.42.4-7 build passes all four specs (checklist, flock, licence, users) on the same kernel; `--verbose` reported a 2.54 s wait.
