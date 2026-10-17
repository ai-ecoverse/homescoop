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
