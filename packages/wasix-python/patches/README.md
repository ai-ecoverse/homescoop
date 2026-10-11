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

Until the sysroot is rebuilt, wasix-python links `lock_stubs.c` with
`-Wl,--wrap=flock,--wrap=fcntl,--wrap=lockf` (same pattern as uid stubs).
`fcntl_wasix_extra.h` mirrors the 7/8/9 cmd numbers for the fcntl module.

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

Apply against the CPython 3.14.2 tree used for wasix-python (shipped in the
interpreter package, not as a standalone libc change).

## `libffi-wasix-varargs.patch` (wasix-python 3.14.2-16)

Against wasix-org/libffi 09cbf7d (`recipe.yaml` sources.libffi), `src/wasm32/ffi.c`, WASIX path (not Emscripten):

- `ffi_prep_cif_machdep_var` returned `FFI_BAD_ABI` ("Varargs are not yet supported without emscripten"), so ctypes raised `ffi_prep_cif_var failed` for every variadic call (`printf`, `snprintf`, `sscanf`, `open(…, mode)`, `fcntl`, `ioctl`).
- clang's wasm32 C ABI passes a variadic function's extra arguments as **one** trailing `i32`: a pointer to a buffer holding them, each at its natural alignment in 4-byte slots (8 for 64-bit integers and `double`, 16 for `long double`), aggregates by pointer. `ffi_call` now puts only the fixed arguments into the `wasix_call_dynamic` value buffer, lays the variadic ones out in an aligned buffer on the stack, and appends its address. `ffi_prep_cif_machdep_var` accepts the cif (one extra argument against `MAX_ARGS`).
- libffi's generic `ffi_prep_cif_var` already rejects variadic `float` and sub-`int` types (C default promotions), so they never reach the buffer.
- Checked with a C program through `ffi_prep_cif_var` on slicc-kernel 1.51.0 (snprintf with int/double/long long/char*/long double, sscanf, open with mode, plus a fixed call) and by `cert/ctypes-varargs.mjs`.
- Upstream: offering it to wasix-org/libffi is Lars's call.

