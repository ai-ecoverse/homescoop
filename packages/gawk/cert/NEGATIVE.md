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
