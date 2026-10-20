# Negative proof (gawk)

**Date:** 2026-10-07

## Empty wasm (spec not vacuous)

`prove-negative.mjs --package gawk` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Patch reverted (emscripten-no-fork-popen.patch)

Remove `packages/gawk/emscripten-no-fork-popen.patch` and run
`FORCE=1 bash scripts/host-run.sh gawk` (2026-10-07). Build succeeds, but
`cert/checklist.mjs` fails: `system("echo sys-ok")` returns status 0 without
printing `sys-ok` (fork-based `gawk_system` / non-`PIPES_SIMULATED` path does
not run the child under slicc-kernel).

```text
AssertionError: The input did not match the regular expression /sys-ok/. Input:
'status 0\n'
```

**Good tarball:** `@ai-ecoverse/wasm-gawk@5.4.1-1` — system / getline pipe /
`print | cmd` all pass.

## /inet/tcp: the cli-profile build (5.4.1-1)

5.4.1-1 linked the `cli` shim profile, which has no `slicc_socket.c`, so
getaddrinfo and connect() were Emscripten's. `cert/inet.mjs` fails at the
first case, even for a numeric address (slicc-kernel 1.30.0, Node entry):

```
proxy rc=2 stderr=gawk: cmd. line:1: warning: remote host and port information (127.0.0.1, 3128) invalid: Name does not resolve
```

5.4.1-2 links `clinet` (cli + sockets): the round trip, the tailnet name,
"Connection refused" and "Name does not resolve" for an unknown host.

## 5.4.1-4: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs gawk` (host-run's #908 check) fails on the published 5.4.1-3: 1 file(s) ship 2,252,568 bytes of DWARF.

The published 5.4.1-3 also has 2 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/gawk.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

5.4.1-4 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 5.4.1-3 too; the negative is the #908 check.

## 5.4.1-5: extensions and -M documented (homescoop#681; 2026-10-20)

There's no behaviour change, so the negative is the documentation: `cert/extensions.mjs` reads the package README and fails on 5.4.1-4's README, which doesn't mention `-i inplace`, `--disable-extensions` or `-M`. The messages it pins come from npm's 5.4.1-4 (slicc-kernel 1.30.0, users enforce) and are unchanged in this build.

## 5.4.1-6: shim drift (homescoop#1491; 2026-10-20)

5.4.1-6 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 5.4.1-5 in the binaries (5.4.1-5 was published before the shims changed), so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
