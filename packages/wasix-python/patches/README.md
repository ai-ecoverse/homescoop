# wasix-python patches

## CPython 3.15.0 (wasix-python 3.15.0-1, homescoop#761)

Every `cpython-*.patch` was regenerated against pristine 3.15.0: applied in `build.sh`'s order, each hunk checked where it landed, then re-diffed, so all of them apply at offset 0 with no fuzz. `build.sh` applies them with `-F0`, so a hunk that no longer matches fails the build instead of landing somewhere else. Two hunks of the 3.14.2 files did land in the wrong place, matched exactly but at the wrong offset: 3.15's `configure` gives Emscripten the same `py_cv_module_*=n/a` block as WASI, so `cpython-configure-wasix.patch`'s grp/pwd/resource hunk and `cpython-multiprocessing-wasix.patch`'s `_multiprocessing`/`_posixshmem` hunk were applied to the Emscripten case. None was dropped: 3.15.0 still has every problem they fix.

| patch | 3.15.0 |
| --- | --- |
| `cpython-configure-wasix.patch` | regenerated; the module hunks now edit the WASI case (3.15 still marks fcntl, grp, pwd, mmap, resource, termios n/a on WASI and keeps wasm32-wasi-threads' 10 MiB memory) |
| `cpython-platform-triplet-wasix.patch` | regenerated, same change (3.15 has no wasm32-wasix triplet) |
| `cpython-user-site-wasi.patch` | regenerated, same change (offsets only) |
| `cpython-subprocess-posix-spawn.patch` | regenerated, same change (3.15's `_can_fork_exec` still excludes wasi; offsets only) |
| `cpython-stdout-line-buffer-nonreg.patch` | regenerated, same change |
| `cpython-ensurepip-installed-pip.patch` | regenerated, same change (3.15 adds a `--no-compile` branch just above it; bundled pip 26.2.1) |
| `cpython-multiprocessing-wasix.patch` | regenerated; the hunk now edits the WASI case (3.15 still marks `_multiprocessing` and `_posixshmem` n/a) |
| `cpython-multiprocessing-util-wasix.patch` | regenerated, same change |
| `cpython-multiprocessing-noshare-wasix.patch` | regenerated, same change |
| `cpython-multiprocessing-unix-listener-wasix.patch` | regenerated, same change |
| `cpython-thread-native-id-wasix.patch` | rebased by hand: 3.15 added a Solaris branch at both places the 3.14.2 hunks matched, which made them fail; the WASI branch now follows it |
| `cpython-fork-hint-wasix.patch` | regenerated, same change |
| `libffi-wasix-varargs.patch` | unchanged: it patches wasix-org/libffi 09cbf7d, whose pin is unchanged |
| `wasix-libc-*.patch` | unchanged: they patch the sysroot's libc, not CPython, and `build.sh` doesn't apply them (the advisory-locks one is historical) |

# wasix-python libc patches

## `wasix-libc-setitimer-it-value.patch`

Upstream wasix-libc `setitimer` only forwarded `itimerval.it_interval` to
`wasix_32v1.proc_raise_interval` (always with `repeat=TRUE`). One-shot
`alarm(N)` / `signal.alarm` sets `it_value=N` and `it_interval=0`, so the host
saw interval `0` and cancelled the timer.

The patch:

1. Adds a new import `wasix_32v1.proc_raise_interval2` (4 args) that takes both
   `it_value` (initial) and `it_interval` as nanosecond timestamps, plus `repeat`.
2. Makes `setitimer` call `__wasi_proc_raise_interval2`.
3. Leaves the legacy 3-arg `proc_raise_interval` import and wrapper **untouched**
   so stock Wasmer binaries keep a stable ABI (same pattern as `proc_spawn2`).

Apply against a wasix-libc checkout before rebuilding the wasixcc sysroot that
links `@ai-ecoverse/wasix-python`. Ship only with wasix-python (do not publish
a standalone libc bump ahead of the interpreter package).

```bash
# example
git clone https://github.com/wasix-org/wasix-libc.git
cd wasix-libc
../packages/wasix-python/apply-wasix-libc-alarm-patch.sh .
# then rebuild sysroot-exnref-ehpic (or ehpic) and relink python
```

### Host ABI (new)

```text
wasix_32v1.proc_raise_interval2(
  sig: i32, initial: i64 /* ns */, interval: i64 /* ns */, repeat: i32
) -> errno
```

SLICC serves both `proc_raise_interval` (legacy 3-arg) and `proc_raise_interval2`.

## `wasix-libc-clock-nanosleep-eintr.patch`

Upstream cloudlibc `clock_nanosleep` mapped every `poll_oneoff` failure to
`ENOTSUP` (58), including `EINTR`. After `signal.alarm`, CPython's `time.sleep`
retries only on `EINTR` (PEP 475), so interrupted sleeps raised
`OSError: [Errno 58] Not supported` instead of resuming.

The patch:

1. Returns `EINTR` when `poll_oneoff` / the event reports `__WASI_ERRNO_INTR`.
2. For relative sleeps, fills `*rem` via `clock_gettime` before/after (so
   `nanosleep` / `sleep` / `usleep` inherit correct remaining time).
3. Still returns `ENOTSUP` for other poll failures.

`apply-wasix-libc-alarm-patch.sh` applies this patch together with the setitimer
one. Ship only with wasix-python.

## uid/gid 1000 (wasix-python 3.14.2-6)

SLICC's realm reports every file as owned by uid/gid `1000`, but wasix-libc's
`getuid` / `geteuid` / `getgid` / `getegid` return `0` (triggers pip's
"Running pip as the root user" warning). Until a wasix-libc sysroot patch
ships, `uid_stubs.c` provides `__wrap_getuid`/`geteuid`/`getgid`/`getegid` via
`-Wl,--wrap=…` (plain multiply-defined .o loses to whole-archived `-lc`). Same idea as Emscripten's `slicc_libc_gaps.c`.
Also in 3.14.2-6: static `_bz2` (libbz2) and `_lzma` (liblzma) into python.wasm.

Also `pwd_grp_stubs.c` wraps `getpwuid`/`getpwnam`/`getgrgid`/`getgrnam` (+ `_r`)
for passwd-less realms (user/1000/`/home/user`).

## `wasix-libc-advisory-locks-noop.patch`

**Advisory locks are no-ops in the SLICC realm** (Emscripten parity). Upstream
cloudlibc `fcntl` returns `EINVAL` for unknown cmds, and wasix-libc ships no
`flock`/`lockf`. That breaks `filelock`, pip's cache, sqlite journal fallbacks,
jupyter, and conda-style tools that treat lock failure as fatal.

The patch:

1. Adds `F_RDLCK`/`F_WRLCK`/`F_UNLCK` and `F_GETLK`/`F_SETLK`/`F_SETLKW`
   (**7/8/9**) to `__header_fcntl.h`. Values sit after WASI
   `F_DUPFD_CLOEXEC` (6) so they do **not** collide with Linux's 5/6 (which
   alias WASI `F_DUPFD` / `F_DUPFD_CLOEXEC`).
2. Makes cloudlibc `fcntl(F_SETLK|F_SETLKW)` succeed and `F_GETLK` report
   `F_UNLCK`.
3. Adds `flock()` / `lockf()` no-op sources under `libc-bottom-half/sources/`.

**Historical; not applied.** wasix-sysroot -30 brought real fcntl record locks and `lockf` (`slicc.fcntl_lock`, F_GETLK/F_SETLK/F_SETLKW 12/13/14). -34 brought real `flock` (`slicc.flock`, per open file description). Up to 3.14.2-25 wasix-python linked `lock_stubs.c` with `-Wl,--wrap=flock`, a no-op. Since -26 `fcntl.flock` is libc's. `fcntl_wasix_extra.h`'s `#ifndef` fallbacks don't apply, because the sysroot defines the constants.

## `cpython-stdout-line-buffer-nonreg.patch` (wasix-python 3.14.2-7)

**Kept on purpose** (not a leftover for untyped pipes). Since wasix-sysroot
-21, pipes report `S_IFIFO` (or `S_IFSOCK` on slicc-kernel 1.47.3–1.48.x), so
stock CPython would block-buffer stdout on a pipe. This patch still
line-buffers stdout whenever it is not a regular file so agent/`tee`
harnesses stream output and a wasm trap does not lose up to 8 KB of buffer.

The patch changes `create_stdio()` in `Python/pylifecycle.c`: when
`buffered_stdio` is on, **stdout** is line-buffered if it is not a regular
file (`fstat` + `!S_ISREG`). Terminals already line-buffer; `> file` stays
block-buffered; `PYTHONUNBUFFERED`/`-u` still win; stderr unchanged. `fstat`
failure keeps historic block-buffering.

Apply against the CPython tree used for wasix-python (3.15.0 since 3.15.0-1; shipped in the
interpreter package, not as a standalone libc change).

## `cpython-ensurepip-installed-pip.patch` (wasix-python 3.14.2-17)

`Lib/ensurepip/__init__.py`, `_bootstrap`: `python -m venv` (and `ensurepip` in a venv) ran pip **from the bundled wheel**, a zip without bytecode, so every venv compiled pip's ~600 modules from source before pip installed itself (and compiled its 398 files again). The package's own `site-packages/pip` is the same pip (unpacked from that wheel at build time) with unchecked-hash `.pyc`. On WASI, in a venv, without `--root`/`--user`, and when `site-packages/pip-<_PIP_VERSION>.dist-info` exists in the base, ensurepip now runs that pip (`sys.path` gets the base purelib instead of the wheel) with `--ignore-installed`, so it installs the wheel into the venv instead of finding the base's copy. The installed result is unchanged (pip from the same wheel, `INSTALLER` pip, scripts with the venv's python). `python -m venv` with pip takes about half the time (Node entry: 10-13 s vs 22-28 s on a loaded host). It was the step that ran past the browser-cert harness's 30 s per call on slower CI runners (#300).

## `libffi-wasix-varargs.patch` (wasix-python 3.14.2-16)

Against wasix-org/libffi 09cbf7d (`recipe.yaml` sources.libffi), `src/wasm32/ffi.c`, WASIX path (not Emscripten):

- `ffi_prep_cif_machdep_var` returned `FFI_BAD_ABI` ("Varargs are not yet supported without emscripten"), so ctypes raised `ffi_prep_cif_var failed` for every variadic call (`printf`, `snprintf`, `sscanf`, `open(…, mode)`, `fcntl`, `ioctl`).
- clang's wasm32 C ABI passes a variadic function's extra arguments as **one** trailing `i32`: a pointer to a buffer holding them, each at its natural alignment in 4-byte slots (8 for 64-bit integers and `double`, 16 for `long double`), aggregates by pointer. `ffi_call` now puts only the fixed arguments into the `wasix_call_dynamic` value buffer, lays the variadic ones out in an aligned buffer on the stack, and appends its address. `ffi_prep_cif_machdep_var` accepts the cif (one extra argument against `MAX_ARGS`).
- libffi's generic `ffi_prep_cif_var` already rejects variadic `float` and sub-`int` types (C default promotions), so they never reach the buffer.
- Checked with a C program through `ffi_prep_cif_var` on slicc-kernel 1.51.0 (snprintf with int/double/long long/char*/long double, sscanf, open with mode, plus a fixed call) and by `cert/ctypes-varargs.mjs`.
- Upstream: offering it to wasix-org/libffi is Lars's call.


## `cpython-multiprocessing-noshare-wasix.patch` (wasix-python 3.14.2-23)

WASIX processes share no memory, so multiprocessing's shared memory never
reached another process: a child's writes to an `mp.Value`/`mp.Array` (any
`lock`) or a `SharedMemory` were lost without an error (homescoop#516).

- `multiprocessing.heap`'s arena reduction raises `NotImplementedError` on
  WASI, naming Value, Array and Barrier (since -24) and recommending a
  Queue, a Pipe or a Manager. A shared ctypes object passed to a child fails at `start()`; inside
  one process it works as before.
- `multiprocessing.shared_memory` raises `ImportError`, as on upstream WASI
  builds (no `_posixshmem` there). `_posixshmem` stays built, since the
  resource tracker imports it.
- Without `os.fork`, `multiprocessing.context` drops the `fork` and
  `forkserver` contexts, so `get_all_start_methods()` is `['spawn']` and
  `get_context("fork")` raises `ValueError`. A build with `os.fork`
  (homescoop#357) keeps them.

## `cpython-multiprocessing-unix-listener-wasix.patch` (wasix-python 3.14.2-23)

slicc-kernel before 1.103.1 keeps path-bound AF_UNIX sockets out of the
filesystem (slicc-kernel#753, fixed in 1.103.1), so `SocketListener`'s `os.unlink(path)` at close got
ENOENT, and `multiprocessing.Manager()` printed a traceback from its
finalizer at exit (homescoop#515). On WASI the unlink tolerates a missing
path.

## `cpython-thread-native-id-wasix.patch` (wasix-python 3.14.2-23)

CPython defines `PY_HAVE_THREAD_NATIVE_ID` only for Linux, macOS, Windows,
the BSDs and AIX, so WASI builds had no `threading.get_native_id()` and
`Thread.native_id` was `None`; scipy's uarray (`scipy.fft.set_backend`)
raised `AttributeError` (homescoop#587). WASIX has a per-thread id
(`__wasi_thread_id`, `wasix_32v1.thread_id`): the patch defines the macro
for `__wasi__` and returns that id. Within a process it is unique per live
thread (slicc-kernel: 1 for the main thread, then 2, 3, …); unlike Linux it
is not system-wide.

## `cpython-fork-hint-wasix.patch` (wasix-python 3.14.2-25, homescoop#357)

The package ships two pythons: `bin/python.wasm` without fork, and `bin/python-fork.wasm` with it (`HAVE_FORK`, fully asyncified). `PYTHON_FORK=true` selects the second one through slicc.commands `variants`. The stdlib is shared, and the patch only acts where `os.fork` is missing:
- **`Lib/os.py`:** a module `__getattr__` makes `os.fork` and `os.forkpty` raise `AttributeError("os.fork() isn't available in this python. Re-run with PYTHON_FORK=true (needs slicc-kernel >= 1.110.0) to use the fork-capable build.")`. It's an `AttributeError`, so `hasattr(os, "fork")` stays `False` and feature checks work as before. Every other missing name keeps CPython's message.
- **`Lib/multiprocessing/context.py`:** `get_context("fork"/"forkserver")`, and so `set_start_method`, raise `ValueError` with the same hint.
- The default start method stays `spawn` on WASI even when forkserver exists, as in the fork build. Upstream 3.14 and 3.15 would pick forkserver there.
