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
