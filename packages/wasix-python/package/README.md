# `@ai-ecoverse/wasix-python`

CPython 3.14 for slicc WASIX (`commands` `python` / `python3`).

## Features

- PIE dynamic-main (`dylink.0`) on wasix-sysroot 2025.9.30-18's `sysroot-ehpic` (legacy wasm EH), SOABI `cpython-314-wasm32-wasix`; native side modules (py-numpy, py-scipy, py-pandas, …) load by `dlopen`
- **File modes** (3.14.2-12, on slicc-kernel ≥ 1.35.1; older kernels keep the no-op modes): `os.umask`, `open()`/`os.mkdir` create modes, `os.chmod`, `tempfile.mkstemp` 600 / `mkdtemp` 700, pip console scripts 755
- Built in: `ssl`/`hashlib` (OpenSSL 3.5.9, `@ai-ecoverse/wasix-openssl`), `zlib` 1.3.1, `bz2`, `lzma` (xz 5.8.4), `sqlite3` (3.53.4; FTS5, JSON, math, R*Tree; no WAL, no extensions), `readline` 8.3 (ncurses 6.5 terminfo compiled in: xterm, screen, tmux, vt100, linux), `mmap`, `fcntl`, `termios`, `resource`, `pwd`, `grp`, `select`
- No `fork`/`vfork`; `subprocess` via `os.posix_spawn` (`proc_spawn2`/`3`)
- `os.getuid()`/`getgid()`/`getgroups()` and `pwd`/`grp` come from slicc-kernel's process credentials and its `/etc/passwd`/`/etc/group` (3.14.2-13, wasix-sysroot -20; slicc-kernel ≥ 1.44.0, no fallback: ids are -1 on older kernels). Root is uid 0 with home `/root`.
- Advisory file locks (`flock`, `fcntl` F_SETLK*, `lockf`) are no-ops (Emscripten parity)
- stdout is line-buffered unless it is a regular file, so output streams and survives crashes
- `signal.alarm`/`setitimer` and `time.sleep` resuming after a signal (the sysroot's libc patches, `patches/`)
- Bundled `pip` 25.3; `.pyc` are unchecked-hash
- Not built: `ctypes` (no libffi for WASIX), `_uuid`, `curses`, `dbm`, `_zstd`, `tkinter`
- `TZ` POSIX rules work (`EST5EDT,M3.2.0,M11.1.0`; wasix-sysroot -18, homescoop#193); `zoneinfo` works with the `tzdata` package

Since 3.14.2-12 the package is cross-built from source in CI (`build.sh`); see `THIRD-PARTY-NOTICES.md` for the statically linked libraries.

The license is `PSF-2.0 AND GPL-3.0-or-later`, because GNU Readline is linked
statically. Since 3.14.2-13, `time.tzset()` exists and honours POSIX `TZ` rules.
The sysconfig records (`_sysconfigdata*`, `_sysconfig_vars*.json`) carry no
build-machine paths, host compilers or private stub archives.

## Side modules: C++ runtime ABI

Native extensions are `dylink.0` side modules that import the C++ runtime from
`python.wasm`: `libc++`, `libc++abi` and `libunwind` of upstream wasix-libc
**v2026-07-03.1** `sysroot-ehpic` (legacy wasm EH, PIC), which 3.14.2-11 used
too. That ABI has:

- `_Unwind_CallPersonality(void *)` and the personality `__gxx_personality_wasm0`;
- a plain global `__wasm_lpad_context` (imported through `GOT.mem`);
- `__cxa_thread_atexit`.

Build C++ side modules against that runtime: wasixcc with
`WASIXCC_WASM_EXCEPTIONS=legacy`, `WASIXCC_PIC=yes`, and that sysroot's
`libc++` headers. wasix-sysroot ≥ 2025.9.30-14 rebuilt the runtimes from a
newer LLVM. There, `__gxx_wasm_personality_v0(void *)` replaces
`_Unwind_CallPersonality` and `__wasm_lpad_context` is `thread_local`, so a
module built on them does not load into this `python.wasm`, and the reverse
corrupts memory on the first C++ exception. `test/side-abi.mjs` checks every
published py-* side module's imports against `python.wasm` at build. It fails
if one is missing, or if a `GOT.mem` import resolves to `thread_local` data the
side modules were not built for.

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

`sitecustomize.py`, `_slicc_site.py` and `site-packages/slicc-executable.pth`
are the slicc additions (`stdlib/` in the recipe).
