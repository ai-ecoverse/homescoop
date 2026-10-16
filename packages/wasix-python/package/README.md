# `@ai-ecoverse/wasix-python`

CPython 3.14 for slicc WASIX (`commands` `python` / `python3`).

## Features

- PIE dynamic-main (`dylink.0`) on wasix-sysroot 2025.9.30-31's `sysroot-ehpic` (legacy wasm EH), SOABI `cpython-314-wasm32-wasix`; native side modules (py-numpy, py-scipy, py-pandas, …) load by `dlopen`
- **File modes** (3.14.2-12, on slicc-kernel ≥ 1.35.1; older kernels keep the no-op modes): `os.umask`, `open()`/`os.mkdir` create modes, `os.chmod`, `tempfile.mkstemp` 600 / `mkdtemp` 700, pip console scripts 755
- Built in: `ssl`/`hashlib` (OpenSSL 3.5.9, `@ai-ecoverse/wasix-openssl`), `zlib` 1.3.1, `bz2`, `lzma` (xz 5.8.4), `sqlite3` (3.54.0; FTS5, JSON, math, R*Tree; no WAL, no extensions), `readline` 8.3 (ncurses 6.5 terminfo compiled in: xterm, screen, tmux, vt100, linux), `ctypes` / `_ctypes` (wasix-org/libffi; needs slicc-kernel#306 step 1 for `call_dynamic` + `closure_{allocate,free}`), `mmap`, `fcntl`, `termios`, `resource`, `pwd`, `grp`, `select`
- No `fork`/`vfork`; `subprocess` via `os.posix_spawn` (`proc_spawn2`/`3`)
- `os.getuid()`/`getgid()`/`getgroups()` and `pwd`/`grp` come from slicc-kernel's process credentials and its `/etc/passwd`/`/etc/group` (3.14.2-13, wasix-sysroot -20; slicc-kernel ≥ 1.44.0, no fallback: ids are -1 on older kernels). Root is uid 0 with home `/root`.
- Record locks (`fcntl` F_SETLK*, `lockf`) go through slicc-kernel (since -21, below); `flock` is a no-op
- stdout is line-buffered unless it is a regular file, so output streams and survives crashes
- `signal.alarm`/`setitimer` and `time.sleep` resuming after a signal (the sysroot's libc patches, `patches/`)
- Bundled `pip` 25.3; `.pyc` are unchecked-hash
- Not built: `_uuid`, `curses`, `dbm`, `_zstd`, `tkinter`
- `TZ` POSIX rules work (`EST5EDT,M3.2.0,M11.1.0`; wasix-sysroot -18, homescoop#193); `zoneinfo` works with the `tzdata` package

Since 3.14.2-12 the package is cross-built from source in CI (`build.sh`); see `THIRD-PARTY-NOTICES.md` for the statically linked libraries.

Since 3.14.2-24 (wasix-sysroot -31):

- `multiprocessing.Manager()` works: `dict`, `list`, `Queue`, `Namespace`,
  `Value` and the other managed objects, also passed to spawned children,
  over an AF_UNIX socket. Up to -23 the first proxy call raised
  `TypeError: str, bytes or bytearray expected, not int`: WASIX's libc
  returned family 0 and no path from `getsockname`, `getpeername` and
  `accept` for every AF_UNIX socket (homescoop#515). `socket.getsockname()`
  of a bound AF_UNIX socket now gives its path, and an unbound one `''`.
- A Manager is what the -23 error for shared ctypes recommends, so that
  advice holds now (homescoop#669). The error also names `Barrier`, which
  keeps its state in shared memory too.
- From the sysroot: `select.poll` reports `POLLHUP` for a registered fd with
  no events whose peer closed, and `POLLERR` for a pipe write end whose
  reader is gone; a process is no longer limited to 256 named semaphores.

Since 3.14.2-23:

- `multiprocessing.connection`'s `Listener` on an AF_UNIX path closes
  cleanly on every kernel. slicc-kernel before 1.103.1 keeps socket paths out
  of the filesystem (slicc-kernel#753), so the path it unlinks at close was
  already gone, and up to -22 `close()` raised `FileNotFoundError` there. `multiprocessing.Manager()` also
  needs WASIX's libc to return AF_UNIX addresses from `getsockname`, which
  comes with wasix-sysroot -31 in the next release (homescoop#515).
- `threading.get_native_id()` and `Thread.native_id` exist (WASIX's thread id;
  homescoop#587). Up to -22 they were missing or `None`, and
  `scipy.fft.set_backend`/`skip_backend` raised `AttributeError`.
- **Shared memory fails loudly instead of silently** (homescoop#516).
  Processes share no memory here, so nothing written into an `mp.Value`,
  `mp.Array` (with or without a lock) or `SharedMemory` ever reached another
  process, and up to -22 nothing said so.
  - Passing a `Value`, `Array` or other shared ctypes object to a child
    (`Process` arguments, `Pool` initargs) now raises `NotImplementedError` at
    `start()`, naming a Queue, a Pipe or a Manager as the alternatives. Inside
    one process (threads) they work as before.
  - `multiprocessing.shared_memory` raises `ImportError` on import, as on
    upstream WASI builds, and `multiprocessing.managers.HAS_SHMEM` is
    `False`.
  - `multiprocessing.get_all_start_methods()` is `['spawn']`, and
    `get_context("fork")`/`("forkserver")` raise `ValueError`. Up to -22 they
    listed `fork` and `forkserver`, and a fork `Process` failed at `start()`
    with `AttributeError` (no `os.fork`, homescoop#357).

Since 3.14.2-22 the `sqlite3` module uses SQLite's `unix` VFS, with `fcntl`
locks, instead of SQLITE_WASI's default `unix-dotfile`, whose `.lock`
directory no other program saw. Python and the sqlite3 CLI (or another
program) now lock each other out on the same database. Up to -21, a CLI write
during a python transaction went through, and python's commit then failed
with `disk I/O error`.

**-22 needs slicc-kernel ≥ 1.100.0** (`engines`; it was ≥ 1.51.0). Its
`fcntl` locks only reach other processes through slicc-kernel's
`slicc.fcntl_lock` (1.100.0, #722). On an older kernel the libc grants every
lock locally, so two python processes writing one database could lose a row
(homescoop#567); -21's `.lock` directory had kept them apart.

Since 3.14.2-21 (wasix-sysroot -30):

- `multiprocessing` works with the `spawn` start method (the default):
  `Pool`, `Queue`, `Lock`, `Semaphore` and the other synchronisation
  primitives, across processes. Its named semaphores are kept by slicc-kernel
  (≥ 1.99.0). `shared_memory` and shared ctypes (`Value`/`Array`, whatever
  their `lock`) aren't shared between processes, because processes don't
  share memory (an error since -23). There is no `fork` start method (no
  `os.fork`).
- `fcntl.lockf`/`fcntl.fcntl` record locks and `os.lockf` go through the libc
  to slicc-kernel (slicc-kernel#722) and hold against other processes, such as
  a second python or the sqlite3 CLI on the same database. On an older kernel
  every lock is granted locally, as before. `fcntl.flock` is still a no-op.

Since 3.14.2-20 (wasix-sysroot -29):

- `select.poll` takes a file descriptor registered with no events. Up to -19
  the call failed with ENOSYS.
- `select.epoll` errors are real: a second `register` is EEXIST and an
  `unregister` of an unregistered fd is ENOENT. Up to -19 both succeeded
  silently. asyncio uses `EpollSelector` on slicc-kernel ≥ 1.95.0 (WASIX
  epoll) and `PollSelector` on older kernels.
- `multiprocessing` had no `_multiprocessing` (fixed in -21).

Since 3.14.2-19 (wasix-sysroot -28):
- signal masks are real: `signal.pthread_sigmask` blocks and unblocks
  through slicc-kernel (≥ 1.88.0), a blocked signal stays pending
  (`signal.sigpending()`) without running its handler or interrupting
  `time.sleep`, and its handler runs once when it is unblocked. Up to
  3.14.2-18 `pthread_sigmask` raised `OSError(0, 'Error')`. Kernels
  before 1.88.0 take wasix-sysroot -28's ENOSYS fallback (its README).
  `signal.sigtimedwait`/`sigwaitinfo`/`sigwait` raise ENOSYS (slicc-kernel#520);
- `sqlite3` (3.54.0 since this release, 3.53.4 before) keeps its compile options; `PRAGMA compile_options` adds `MAX_SCHEMA=10000000`;
- `THIRD-PARTY-NOTICES.md` carries the licence text of every statically
  linked component (see the license paragraph below).

Since 3.14.2-18:
- `ctypes.CDLL(None)` has no `fork` (nor `_Fork`, `__wasi_proc_fork`, …):
  python.wasm no longer exports them (homescoop#296). In 3.14.2-17 calling
  `ctypes.CDLL(None).fork()` crashed the interpreter (a wasm trap): fork needs
  Asyncify on every frame between it and `main`, and ctypes' frames have none.
  `os.fork` stays absent; `subprocess`, `os.posix_spawn` and `os.system` work
  as before.

Since 3.14.2-17 (wasix-sysroot -27):
- `os.utime(path)`, `pathlib.Path.touch()` and everything else that sets a
  file's times to "now" set them to now; up to 3.14.2-16 they set them to
  0 (1970) (wasix-sysroot's broken `utimensat(NULL)`, homescoop#294).
- `os.times()`, `resource.getrusage(RUSAGE_SELF)` and `time.clock`-style
  callers report the process CPU time slicc-kernel keeps; system and
  children's times are 0. Up to -16 they held wall-clock values.
- An empty path is `FileNotFoundError` (`os.stat("")`, `open("")`), as on
  Linux; files have owners on slicc-kernel ≥ 1.59.0 with users on
  (`os.chown`, `os.stat().st_uid`), and `os.access` asks the kernel
  (≥ 1.63.0).
- **A system site directory every user shares:**
  `/usr/local/lib/python3.14/site-packages` is added (with `site.addsitedir`,
  so its `.pth` files run) after python's own site-packages and the py-*
  packages it finds, when it exists. An embedder can drop a `.pth` there once
  for every user. A virtual environment sees it only with
  `--system-site-packages`, as on Linux.
- The py-* discovery cache is per user:
  `${XDG_CACHE_HOME:-~/.cache}/slicc-site/`, never in the package directory
  (which other users cannot write); without a home or a writable cache
  directory there is no cache.
- `pip` and `pip3` are commands (`python3 -m pip`); `pip install --user`
  installs into the user's own site-packages.
- `python -m venv` takes about half as long: ensurepip runs the package's own
  compiled pip instead of pip from the zipped wheel.

Since 3.14.2-16 (wasix-sysroot -22: the `slicc.libc` marker, no exported
itimer helper):
- ctypes calls variadic C functions (`printf`, `snprintf`, `sscanf`,
  `open(path, flags, mode)`, `fcntl`, `ioctl`, …): our libffi passes the
  variadic arguments the way the wasm32 C ABI does
  (`patches/libffi-wasix-varargs.patch`). As on Apple arm64, set `argtypes` to
  the **fixed** parameters (e.g. `[c_char_p]` for `printf`) and pass the rest
  as typed ctypes values (`c_int`, `c_double`, …); without `argtypes` every
  argument is taken as fixed, which is wrong for a variadic function on wasm32.
  Pass `c_double` for `%f`: ctypes does not promote, and a variadic `c_float`
  raises `RuntimeError: ffi_prep_cif_var failed` (libffi rejects it, as on
  every platform).
  3.14.2-15 could not call them at all ("ffi_prep_cif_var failed").
- Signals during blocking calls follow PEP 475 on slicc-kernel ≥ 1.53.3, which
  answers -22-marked programs with EINTR: a signal whose handler returns does
  not shorten `time.sleep`/`select`/`poll`, and ^C raises `KeyboardInterrupt`
  at once (`cert/signals.mjs`).

Since 3.14.2-15:
- `ctypes` / `_ctypes` (wasix-org/libffi) — needs slicc-kernel ≥ 1.51.0 (#306 /
  #316: `call_dynamic`, `closure_{allocate,prepare,free}`, POSIX `dlopen(NULL)` /
  own path / symlink = running main). On 1.49.0, `import ctypes` raises
  `OSError` (not `ImportError`), so **numpy fails** — see `cert/NEGATIVE.md`.
  `cert/sidemods.mjs` (no PYTHONPATH; discovery) gates the py-* re-pin wave.
  Catalog move to -15 rides with the kernel bump (engines are advisory).
- **py-* packages are found without `PYTHONPATH`.** A package that declares
  `slicc.python.sitePackages` in its `package.json` (py-numpy, py-pandas, …) is
  put on `sys.path` when it is installed in python's own project (npm's
  `node_modules`, or pnpm's, including its `.pnpm` store: a local `pnpm add`)
  or, for pnpm ≥ 11 global installs (`pnpm add -g`, one project per package
  under `$PNPM_HOME/global/v<N>/`), in a sibling global project. It is taken
  only if its `slicc.python.requires` abi/platform match (none: pure Python),
  and if the `wasix-python` it resolves to (Node's lookup from its real
  directory) is this python's exact version, so side modules never mix
  interpreter builds; the first package of a name wins. `python -v` reports
  what was skipped and why. The scan is cached per user in
  `${XDG_CACHE_HOME:-~/.cache}/slicc-site/` (since 3.14.2-17; keyed on the package directories and their
  `package.json` stamps; `-v` always rescans); with the cache, a start costs
  about 2 ms more than with discovery off, and less than the same directories
  on `PYTHONPATH`. As with `PYTHONPATH`, `.pth` files in those directories are
  not run. It runs from `site-packages/slicc-executable.pth`, so a venv sees
  py-* packages only with `--system-site-packages`; `SLICC_PYTHON_DISCOVER=0`
  turns it off. A py-* built for another wasix-python (an exact pin with its
  own nested copy, e.g. py-numpy 2.3.2-7 for 3.14.2-13) is refused until it is
  re-pinned; `python -v` names it.

Since 3.14.2-14 (wasix-sysroot -21):
- `asyncio` subprocess pipes work: `os.fstat` gives a pipe its kernel type,
  `S_ISFIFO` on slicc-kernel with pipe types (#307) and a socket on
  1.47.3-1.48.x, either of which asyncio's pipe transports accept;
- `termios`/`tty.setraw` really switch the terminal to raw mode (^C arrives as
  a byte), and `os.get_terminal_size` and `isatty` answer per descriptor
  (slicc-kernel ≥ 1.48.0; older kernels keep the previous behaviour).

The license is `PSF-2.0 AND GPL-3.0-or-later`, because GNU Readline
(GPL-3.0-or-later) is linked statically: `bin/python.wasm` as a whole is a
combined work distributed under the GPL-3.0-or-later. CPython's PSF-2.0 and
the other linked components' licences are GPL-compatible. If you redistribute
`python.wasm`, or an application that bundles it, the GPL-3.0's terms apply to
it: redistributors pass on the Corresponding Source, which is the homescoop
repository at the release's commit plus the sha256-pinned upstream archives
its recipe lists; homescoop keeps those available. Since 3.14.2-19,
`THIRD-PARTY-NOTICES.md` has every linked component's licence text, not just a
table. Since 3.14.2-13, `time.tzset()` exists and honours POSIX `TZ` rules.
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

**Venvs need slicc-kernel ≥ 1.29.0** (`engines` asks for ≥ 1.100.0 since -22, for sqlite's locks; ≥ 1.51.0 before, for `_ctypes`). On older kernels a
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
