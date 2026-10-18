# Negative proof (findutils)

## No credential library, no passwd (published 4.11.0-1, homescoop#459)

4.11.0-1 was linked before the slicc shims carried process credentials and names (homescoop#207). Its `find.wasm` and `xargs.wasm` don't import `slicc_cred_js` or export `slicc_cred_euid`, and the glue doesn't name `slicc_cred_js`, so slicc-kernel treats them as built without the credential ABI. `scripts/check-slicc-cred.mjs` refuses that tarball with 6 problems: both wasm, both as commands, and both glues.

`users.mjs` against 4.11.0-1 on slicc-kernel 1.94.0 and 1.97.0 (Node entry, users `enforce`, 2026-10-16): FAIL. Here `r` is root's file and `c` is chowned 1000:1000; `stat` from coreutils 9.12.0-7 shows `0:0 r` and `1000:1000 c`.

```text
find . -type f -user root    rc=1  find: invalid user name or UID argument to -user: ‘root’
find . -type f -uid 0        ./r
find . -type f -user cone    rc=1  find: invalid user name or UID argument to -user: ‘cone’
find . -type f -printf "%u:%g %U:%G %p\n"
                             1000:1000 1000:1000 ./c
                             0:0 0:0 ./r
find . -type f -nouser       ./c ./r
```

On the Node entry the numeric owners come through. In the wasm realm, the Kernel Coordinator's scan saw every file as 1000:1000 (the kernel's legacy owner for builds without `slicc_cred_js`), so `-user root` and `-uid 0` matched nothing. 4.11.0-2 passes `users.mjs` on both kernels.

## 4.11.0-4: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs findutils` (host-run's #908 check) fails on the published 4.11.0-3: 2 file(s) ship 1,830,414 bytes of DWARF.

The published 4.11.0-3 also has 6 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/xargs.wasm, bin/find.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

4.11.0-4 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 4.11.0-3 too; the negative is the #908 check.
