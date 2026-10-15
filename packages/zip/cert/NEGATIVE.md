# Negative proof (zip)

**Date:** 2026-10-15, slicc-kernel 1.94.0 (users enforce), against the ladder-pr artifact of #429 (`host-zip-pr429`, package.tgz sha256 `0ea3f809cf92d606d5a5297207be068a6f22b683baac39e3cf1f5168cb01e54b`, version 3.0.0-1). This is the first cert/ for zip (homescoop#426), so zip isn't in `scripts/ci-certified.json`.

## Empty wasm

```
browser-cert: FAIL packages/zip/cert/options.mjs (crash at packages/zip/cert/options.mjs:3)
Error: Error: WebAssembly.compile(): BufferSource argument is empty
browser-cert: FAIL packages/zip/cert/roundtrip.mjs (crash at packages/zip/cert/roundtrip.mjs:10)
Error: Error: WebAssembly.compile(): BufferSource argument is empty
prove-negative: ok — cert failed on bad zip tarball (status 1)
```

## The build before #429

main's `build.sh` (at 57e6ab5d … bd70917c) builds nothing:

```
unix/unix.c:11:10: fatal error: 'zip.h' file not found
```

With only `-I.` added, unzip doesn't compile under clang 22: `call to undeclared function 'isatty'` and `'unlink'`, from `unzip.c` and `fileio.c`.

With `-I.` and the unzip fixes, but without zip's configure-equivalent flags (`-DLARGE_FILE_SUPPORT -DZIP64_SUPPORT …`), the package builds, and both specs fail at zip's first run:

```
browser-cert: FAIL packages/zip/cert/options.mjs
AssertionError [ERR_ASSERTION]: zip -v: rc 19
browser-cert: FAIL packages/zip/cert/roundtrip.mjs
AssertionError [ERR_ASSERTION]: zip -r: rc 19
zip error: Not supported (uzoff_t not same size as zoff_t)
```

## The specs aren't vacuous

- `options.mjs`: `zip -v` and `unzip -v` must name Zip 3.0 and UnZip 6.00 and list LARGE_FILE_SUPPORT, ZIP64_SUPPORT and the rest of the published 3.0.0-1's options. A build without the flags fails, as shown above.
- `roundtrip.mjs` runs as the user cone (users enforce):
  - `zip -r` compresses a tree with a nested dir and a 64 KiB file;
  - `unzip -l` must list every entry with the 65536 size;
  - `unzip -t` must report no errors;
  - `unzip -p` must return the exact bytes;
  - `unzip -d` must extract identical files;
  - a missing archive must give rc 9 and `cannot find or open`.
