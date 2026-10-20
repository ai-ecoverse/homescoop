# Negative proof (file)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`.

## Empty wasm

With `bin/file.wasm` truncated to 0 bytes, the checklist fails at the first
`file` (slicc-kernel 1.23.0, Node entry):

```
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## Known-bad build: no libbz2 / liblzma

`build.sh` with `--disable-bzlib --disable-xzlib` (built locally, not
committed) fails at `file -z data.bz2`. Without the library, file falls back
to running an external bzip2, which the wasm realm cannot do:

```
'ERROR:[bzip2: Cannot vfork, Function not implemented] (bzip2 compressed data, block size = 900k)\n'
```

## Spec non-vacuous

Every description and MIME type is compared exactly; the regexes are only for
zip (the date field) and the gzip original-size suffix. An early fixture,
`xz me`, came out as "MGR bitmap" inside the xz, which shows that `-z`
really decompresses and re-runs the magic. The published 5.46.0-2 also
passes, so the rebuild shows no regression on these cases.

## 5.46.0-6: attested build inputs (homescoop#864; 2026-10-17)

5.46.0-6 changes only the build inputs. Each is now a version with provenance: wasm-zlib 1.3.1-4 (was the unattested 1.3.1-2), wasm-bzip2 1.0.8-4 (was 1.0.8-3), and wasm-xz 5.8.4-2 (was the unattested 5.8.1-1). The THIRD-PARTY-NOTICES entry follows liblzma to 5.8.4; COPYING and COPYING.0BSD have the same sha256 at v5.8.4. The cert kernel is 1.110.1 (certified), and the bash and coreutils pins are 5.3.0-19 and 9.12.0-9.

The file code is unchanged, so the published 5.46.0-5 passes `checklist.mjs` too, and the planted negatives above still stand. This build passes `checklist.mjs` on 1.110.1 under users enforce: every type, `-z` through zlib, libbz2 and liblzma, and glue by path.

## 5.46.0-7: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs file` (host-run's #908 check) fails on the published 5.46.0-6: 2 file(s) ship 1,437,359 bytes of DWARF.

The published 5.46.0-6 also has 23 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/file.wasm, lib/libmagic.a (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

5.46.0-7 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 5.46.0-6 too; the negative is the #908 check.

## 5.46.0-8: the cert under users enforce (homescoop#819; 2026-10-18)

5.46.0-8 changes no code or build input. The bump exists because ladder-pr rebuilds the package for the cert change, and publish refuses same-version drift (#982). Until now cert/meta.json had no `"users"`, so ladder-pr booted the kernel with its default user mode, and the published 5.46.0-7 was certified that way. cert-coverage.test.mjs's #819 allowlist names file for exactly that. With `"users": "enforce"` the specs run with the kernel's credentials enforced. The same specs passed under enforce in #960's cert review, on the cert kernel and on slicc-kernel 1.122.2.

## 5.46.0-9: the shim's posix_spawnp searches PATH (slicc-kernel#1165, homescoop#1264; 2026-10-19)

5.46.0-9 links the updated `shims/slicc/slicc_spawn.c`. `posix_spawnp` was plain `posix_spawn`; it now searches PATH as execvp does. A candidate that isn't an executable regular file is skipped, and a bare name that isn't found anywhere still goes to the kernel catalog. On #1264, npm-parity found that the build differs from the published 5.46.0-8 in lib/libmagic.a, so this is a packaging bump. The package's own code is unchanged. The behaviour test is coreutils' `cert/spawnp-path.mjs` (`timeout`, the shim's one Emscripten caller that a cert drives).

## 5.46.0-10: shim drift (homescoop#1491; 2026-10-20)

5.46.0-10 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 5.46.0-9 in `THIRD-PARTY-NOTICES.md`, `bin/file` and `lib/libmagic.a`, so this is a packaging bump. The package's own code is unchanged. `THIRD-PARTY-NOTICES.md` also gains the slicc-shims section that every wasm linking the shims now carries (homescoop#1388). The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.
