# py-cffi: negative proof

## python-range.mjs: 2.1.1-2 nests a second python under a later 3.15 patch release (2.1.1-3; homescoop#1939; 2026-11-18)

npm `@ai-ecoverse/py-cffi@2.1.1-2` takes wasix-python as the patch-line range. `npm install --package-lock-only` of its tarball beside a stand-in `@ai-ecoverse/wasix-python` 3.15.2-1 (a package.json-only tarball, `python-range.mjs`'s `fakePython`) resolves a second python from the registry: `node_modules/@ai-ecoverse/py-cffi/node_modules/@ai-ecoverse/wasix-python` 3.15.0-10. `_slicc_site` refuses a py-\* whose python isn't the one running, so on wasix-python 3.15.2-1 its import would fail. 2.1.1-3's repack, with the series range, resolves one python, at the top level, with 3.15.1-1, 3.15.2-1 and 3.15.29-1 stand-ins and with the floor and newest from npm.

## 2.1.1-1 without cffi-wasix-closures.patch (homescoop#2119; 2026-11-17)

The same build, with `_cffi_backend.c` compiled from the unpatched sdist and the same flags, swapped into this tarball. Run on slicc-kernel 1.189.2 (users enforce) and wasix-python 3.15.0-8 with `scripts/browser-cert/run.mjs --package py-cffi`:

- `cert/abi.mjs` and `cert/api.mjs` fail at their first callback. Without the patch, cffi allocates its trampolines in write+execute pages (`malloc_closure.h`), and wasm has none:

  ```
  MemoryError: Cannot allocate write+execute memory for ffi.callback(). You might be running on a system that prevents this.
  ```

- `cert/import.mjs` and `cert/notices.mjs` pass: importing doesn't make a closure.

With the patch, all four specs pass. The ABI spec's callbacks also include libc's `qsort` from `python.wasm`, a callback that raises (`error=-1`), and several closures alive at once.

## The specs aren't vacuous

- `abi.mjs` and `api.mjs` check exact values for every call: integers at the edges of their widths, struct fields after a round trip through C, callback call orders, varargs sums, `errno`, and `ffi.gc` destructor counts.
- `api.mjs` checks that its module is `_cffi_backend.FFI` from this package, and that the `cffi` package isn't imported. A downstream module needs only `_cffi_backend`.
- `test/side-imports.mjs` (run by build.sh and `test/backend.test.mjs`) fails a `_cffi_backend` that defines any `ffi_*` symbol or doesn't import libffi's functions from `python.wasm`. That is, a build that linked a second libffi.
