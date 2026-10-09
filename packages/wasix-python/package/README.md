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

## Virtual environments (slicc-kernel ≥ 1.29.0)

```text
python -m venv v && v/bin/pip install requests && v/bin/python -c "import requests"
```

**Venvs need slicc-kernel ≥ 1.29.0** (`engines` says so). On older kernels a
venv's `bin/python` and `bin/pip` run as the base interpreter: `v/bin/pip
install` then installs into the **base** package directory, not the venv.

CPython cannot find its own executable here (WASI `stat()` has no permission
bits, so its PATH search never matches), so `_slicc_site.py` sets
`sys.executable` from PATH. Two hooks run it:
`site-packages/slicc-executable.pth` for the base interpreter (a
`sitecustomize` of yours on `PYTHONPATH` cannot switch it off) and the stdlib
`sitecustomize.py` for venvs without system site-packages. A `sitecustomize`
of your own still runs after ours, and `import sitecustomize` returns yours.

`python` and `python3` set `"argv0Path": true`, so slicc-kernel ≥ 1.29.0
(#168) passes a venv's `bin/python` path as `argv[0]`; that is how CPython
finds the venv's `pyvenv.cfg`:

| | slicc-kernel < 1.29.0 | slicc-kernel ≥ 1.29.0 |
| --- | --- | --- |
| `v/bin/python`, `v/bin/pip`, venv console scripts | run as the **base** interpreter (install into, and import from, the base) | run **in the venv** |
| `source v/bin/activate; python …` | base interpreter | in the venv |
| `uv run …` ([`@ai-ecoverse/wasix-uv-shim`](https://www.npmjs.com/package/@ai-ecoverse/wasix-uv-shim)) | in the venv | in the venv |

3.14.2-11 is 3.14.2-9's files plus `sitecustomize.py`, `_slicc_site.py` and
`site-packages/slicc-executable.pth`.
