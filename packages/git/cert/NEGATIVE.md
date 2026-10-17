# Negative proof (git)

**Date:** 2026-10-07  
No SLICC patches on this package.


## Users: 2.55.0-13 and slicc-kernel 1.44.0 (H1, homescoop#207)

- **2.55.0-13** (a repack of -11's bytes): `git var GIT_AUTHOR_IDENT` with only `user.email` set fails with `fatal: unable to auto-detect name (got 'Unknown')` as root and as `cone`, since getpwuid found nobody.
- **This build on slicc-kernel 1.44.0:**
  - the author is `root` / `cone`;
  - but root's own `~/repo` is "dubious": 1.44.0 reports every file as uid 1000 and root is uid 0, so git refuses it (`fatal: detected dubious ownership`; `git config` in it: `fatal: not in a git directory`).
  - The kernel's fix (stat owner = the caller's euid/egid) is what `cert/users.mjs` runs on.

## Empty wasm

`prove-negative.mjs --package git` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output case (in-spec)

`cert/checklist.mjs` asserts clone/show after push yields
`homescoop-git-cert\n`, then after fetch/merge `homescoop-git-cert-2\n`.

## Tailnet names (2.55.0-11, homescoop#139)

`cert/tailnet.mjs` against the published 2.55.0-10 (socket shim without the
kernel resolver), slicc-kernel 1.28.0 with the fake uplink:

```
ls-remote rc=128 stderr=fatal: unable to access 'http://peer.tail1234.ts.net:8080/repo.git/': Could not resolve: peer.tail1234.ts.net:8080
```

## Own hostname to the uplink (2.55.0-11 before #149)

The first 2.55.0-11 build (7501856b…, #140's shim) fails the local-workflow
case: the clone's default ident resolves the hostname through the uplink.

```
AssertionError: a local git workflow asked the uplink
+ [ { family: 4, name: 'emscripten' } ]
```

## 2.55.0-17: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

2.55.0-17 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 2.55.0-16 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 2.55.0-16 as well. The build also gets #908's prefix maps and DWARF strip.
