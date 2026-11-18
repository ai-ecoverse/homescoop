# `@ai-ecoverse/py-cffi`

[cffi](https://cffi.readthedocs.io/) 2.1.1, the C Foreign Function Interface for Python, for slicc's WASIX CPython 3.15 (`cpython-315-wasm32-wasix`).

- **What's in it:** `_cffi_backend.cpython-315-wasm32-wasix.so`, a `dylink.0` side module that `python.wasm` loads by `dlopen`, sits at the top of `lib/python3.15/site-packages`, as in cffi's wheels. Beside it are the `cffi` package and `cffi-2.1.1.dist-info`.
- **Who uses it:** compiled cffi modules import `_cffi_backend` by name: PyNaCl's `nacl._sodium`, cryptography's bindings, bcrypt's. pycparser comes with it, as [`@ai-ecoverse/py-pycparser`](https://www.npmjs.com/package/@ai-ecoverse/py-pycparser); `ffi.cdef()` parses with it.
- **Python range:** `>=3.15.0-1 <3.15.1`.
- **Licence:** MIT-0 (`LICENSE`); cffi moved from MIT to MIT No Attribution with 2.x. `THIRD-PARTY-NOTICES.md` has libffi's.

## How it's built

In homescoop's CI, from the PyPI sdist, with wasixcc (PIC, legacy wasm exceptions, the variant `python.wasm` is), against `@ai-ecoverse/wasix-python` 3.15.0-1's headers.

- **One libffi.** `python.wasm` has libffi linked in for `_ctypes` and exports all of it (`ffi_call`, `ffi_prep_cif`, `ffi_prep_cif_var`, `ffi_closure_alloc`, `ffi_prep_closure_loc`, the `ffi_type_*` globals). `_cffi_backend` is compiled against the headers of that same libffi (wasix-org/libffi 09cbf7d, the pin in wasix-python's recipe) and imports those functions. It has no libffi of its own, so cffi and ctypes share one set of closure handlers.
- **Calls and callbacks.** C calls go through WASIX `call_dynamic`. A callback (`ffi.callback`, `@ffi.def_extern`) is a new function in the indirect table (WASIX `closure_allocate`/`closure_prepare`). `cffi-wasix-closures.patch` makes cffi use libffi's closure allocator on WASIX, as it does on Emscripten; upstream's own allocator wants write+execute memory, which wasm doesn't have.
- **Varargs.** Variadic calls (`printf`-style) work through wasix-python's libffi varargs patch.

## What works

These are the cert specs, on slicc-kernel with users enforced:

- **ABI mode:** `ffi.cdef` and `ffi.dlopen` of a C side module, or `ffi.dlopen(None)` for libc and the Python API in `python.wasm`. That covers:
  - integers of every width, `float`, `double`, `long double`, pointers, arrays and strings;
  - structs by value both ways, and by pointer;
  - callbacks into C, with userdata and exceptions;
  - varargs and globals;
  - `ffi.new`, `ffi.gc`, `ffi.buffer` and `ffi.from_buffer`.
- **API mode (out-of-line):** a module whose C was generated on the build host and compiled with wasixcc. It covers:
  - `#define` and `static const` constants, enums, and `...` structs laid out by the compiler;
  - `ffi.callback` and `extern "Python"` (`@ffi.def_extern`);
  - `ffi.errno`.

## What doesn't

- **Compiling in slicc.** `ffi.compile()`, `ffi.verify()` and the setuptools `cffi_modules` hook can't compile there: slicc has no C compiler for side modules. Build extensions on the build host (below), and use ABI mode in slicc.
- **dlopen.** `ffi.dlopen` loads WASIX side modules (`dylink.0`), not native `.so` files.

## Building a cffi extension for wasix-python (downstream recipes)

A recipe runs the package's ffibuilder on the build host, then compiles the C it generates with wasixcc. [`scripts/cffi-wasix.sh`](https://github.com/ai-ecoverse/homescoop/blob/main/scripts/cffi-wasix.sh) does both. py-cffi's own build uses it for its API-mode fixture (`share/py-cffi/selftest/build_selftest.py`):

```bash
source "$ROOT/scripts/build-common.sh"
source "$ROOT/scripts/cffi-wasix.sh"
# ... install-wasixcc.sh (wasix-sysroot -38) and the wasix-python 3.15.0-1 tarball, as py-pillow does
homescoop_cffi_host "$B/cffi-host"                  # py-cffi's cffi sdist + py-pycparser's wheel, pinned
homescoop_cffi_emit "$SRC/src/bindings/build.py:ffi" "$B/gen/_sodium.c" --path "$SRC/src"
CFFI_WASIX_PYINC="$PYINC" homescoop_cffi_ext \
  "$SITE/nacl/_sodium.cpython-315-wasm32-wasix.so" "$B/gen/_sodium.c" \
  -I"$SODIUM/include" "$SODIUM/lib-pic/libsodium.a"
```

Link a library's PIC build into a side module: wasix-* library packages that ship both have it in `lib-pic/` (`lib/` is for static programs).

- **`homescoop_cffi_host <dir>`** fetches the cffi sdist and pycparser wheel that `packages/py-cffi` and `packages/py-pycparser` pin. So the generated C matches the `_cffi_backend` it will run on.
- **`homescoop_cffi_emit <script.py>[:<var>] <out.c> [--path <dir>]... [--chdir <dir>]`** runs the ffibuilder script on a host `python3` (`HOMESCOOP_CFFI_HOST_PY`, any CPython ≥ 3.11) through `scripts/cffi-emit.py`, then calls `emit_c_code`.
  - It uses cffi's ctypes backend, so nothing is compiled for the host, and it doesn't need the host's libffi.
  - The script must call `set_source()`. `if __name__ == "__main__"` blocks don't run.
- **`homescoop_cffi_ext <out.so> <module.c> [args]...`** compiles and links a side module, with py-pillow's and py-kiwisolver's flags.
  - `-l`, `-L`, `-Wl,`, `.a` and `.o` arguments go to the link; the rest go to the compile.
  - Symbols left undefined are resolved when the module loads: `Py*`, libc, and whatever `python.wasm` exports (OpenSSL's libcrypto and libssl, zlib, libffi).
- **Recipe inputs:** a recipe that uses the helper lists `scripts/cffi-wasix.sh`, `scripts/cffi-emit.py`, `packages/py-cffi/recipe.yaml` and `packages/py-pycparser/recipe.yaml` under `inputs:`, so a cffi or pycparser bump rebuilds it.
- **Runtime dependency:** the extension's package depends on `@ai-ecoverse/py-cffi` as a py-* range from this release up to the next patch version, as py-python-dateutil takes py-six (docs/versioning.md).

## `share/py-cffi/selftest`

The cert fixtures, which aren't on `sys.path`:

- `libcffi_selftest.so` and its source: the ABI-mode C side module, with its `cdef.h`.
- `_cffi_selftest.cpython-315-wasm32-wasix.so` and `build_selftest.py`, the API-mode module.

Run them yourself as `cert/abi.mjs` and `cert/api.mjs` in the homescoop repo do.
