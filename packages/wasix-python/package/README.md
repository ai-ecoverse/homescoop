# `@ai-ecoverse/wasix-python`

CPython 3.14 for slicc WASIX (`commands` `python` / `python3`).

## Features

- PIE dynamic-main (`dylink.0`), SOABI `cpython-314-wasm32-wasix`
- No `fork`/`vfork`; `subprocess` via `os.posix_spawn` (`proc_spawn2`/`3`)
- `mmap` builtin via `-D_WASI_EMULATED_MMAN` + `-lwasi-emulated-mman` (mmap/munmap/msync; no madvise/mprotect)
- Bundled `pip` (ensurepip wheel) + `tomllib` / `xmlrpc` for pip’s import graph
- `zlib` for `gzip` (dateutil zoneinfo, etc.)
- static `_bz2` / `_lzma`, `sqlite3`, `readline` (+ termcap shim)
- `pwd`/`grp`/`fcntl`/`termios`/`resource` builtins
- `getuid`/`geteuid`/`getgid`/`getegid` → 1000 via `--wrap` stubs; passwd-less `pwd`/`grp` → user/1000/`/home/user`
- Advisory file locks (`flock` / `fcntl` F_SETLK* / `lockf`) are no-ops in the SLICC realm (Emscripten parity).
- stdout is line-buffered unless it is a regular file, so output streams and survives crashes
- 3.14.2-8 is identical to accepted 3.14.2-7 (npm phantom-staged -7 blocked republish; see npm/cli#9889).
- PRESTAGE: `prestage-check.sh` blocks stage unless SOABI wasix + wrap-getuid=1000
- wasix-libc `setitimer`/`alarm` patch: calls `proc_raise_interval2` with both `it_value` and `it_interval` (legacy `proc_raise_interval` untouched; see `patches/`)

## Acceptance (Wasmer / SLICC)

```text
python -c "import mmap; print('mmap ok')"
python -m pip install --prefix <dir> six   # SLICC: HTTPS via realm proxy + SSL_CERT_FILE
PYTHONPATH=<dir>/lib/python3.14/site-packages python -c "import six"
```

On plain Wasmer without `_ssl`, use a local wheel (`--no-index --find-links`) until openssl/`_ssl` is enabled.
