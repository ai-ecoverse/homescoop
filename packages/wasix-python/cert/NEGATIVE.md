

## 3.14.2-21: python's sqlite3 locks with a .lock directory the CLI doesn't see (-22, homescoop#513)

`locks.mjs` against the published 3.14.2-21 on slicc-kernel 1.100.0 (Node entry, with wasm-sqlite3 3.54.0-3 as the other process; 2026-10-16): FAIL in its sqlite part. -21's sqlite uses SQLITE_WASI's default `unix-dotfile` VFS, i.e. a `.lock` directory, so it never calls `fcntl` locks. While python holds `BEGIN IMMEDIATE`, the CLI's insert goes through, and python's `commit` then fails with `sqlite3.OperationalError: disk I/O error`. k3mw also saw python's row lost when the CLI held the lock. 3.14.2-22 (`-DSQLITE_DEFAULT_UNIX_VFS="unix"`) gets `database is locked` both ways and keeps rows [1, 2, 4]. Its `fcntl.lockf` part passes on -21 already.

## 3.14.2-20: no multiprocessing, no locks between processes (-21, homescoop#481, #407)

`multiprocessing.mjs` against the published 3.14.2-20 on slicc-kernel 1.100.0 (Node entry, 2026-10-16): FAIL at the Pool, `ModuleNotFoundError: No module named '_multiprocessing'` (CPython's configure marks it n/a on WASI). `locks.mjs`: -20 has `os.lockf` = False, and its `fcntl.lockf` went through a `--wrap=fcntl` no-op stub, so no lock ever reached the kernel.

## 3.14.2-19: select.poll fails on an fd with no events, select.epoll errors look like success (-20, homescoop#394, #443)

`epoll.mjs` against the published 3.14.2-19 (wasix-sysroot -28), on slicc-kernel 1.97.0 and 1.94.0 (Node entry, 2026-10-16): FAIL at its first check.
- **`select.poll`:** with a readable pipe (`POLLIN`) and a second pipe registered with events 0, it raises `OSError: [Errno 52] Function not implemented`. -28's libc `poll` refused the events-0 entry.
- **`select.epoll` on 1.97.0:** registering the same fd twice succeeds, and so does unregistering an fd that isn't registered. -28's `epoll_ctl` returned the errno as its value, which Python reads as success. 3.14.2-20 gives EEXIST and ENOENT.
- **asyncio** echoes over loopback with either version, but with -19 an error from epoll would go unnoticed.

On 1.94.0 (no WASIX epoll), `select.epoll()` is ENOSYS with both versions and asyncio picks `PollSelector`.

## 3.14.2-16: os.utime(p) and Path.touch() set 1970; os.times() is the wall clock (-17, homescoop#294)

`round17.mjs` on slicc-kernel 1.71.1 (Node entry, 2026-10-13), with the published 3.14.2-16 (wasix-sysroot -22):

```text
+ '1100000000 mtime=0 mtime=0'
- '1100000000 now now'
```

`os.utime(p)` reaches the libc's `utimensat(…, NULL)`, which up to wasix-sysroot -26 sent explicit times 0/0. `os.times()` and `resource.getrusage()` mixed wall-clock seconds into the CPU fields. -16 also has no system site directory, keeps the discovery cache in the package directory (cone cannot write it: EACCES, rescanned every start) and has no `pip`/`pip3` commands. With -17's `_slicc_site.py`, `.pth` and commands on -16's interpreter, the rest of `round17.mjs` passes, so only the libc part needs the rebuild.

## 3.14.2-15: ctypes cannot call variadic functions

wasix-org/libffi's WASIX backend returned `FFI_BAD_ABI` from `ffi_prep_cif_machdep_var`, so with `argtypes` naming the fixed parameters every variadic call (`printf`, `snprintf`, `sscanf`, `open(…, mode)`, `fcntl`, `ioctl`) raised `ffi_prep_cif_var failed` (hb2's cert-python-3.14.2-15 probes). Without `argtypes`, ctypes passes every argument as fixed, which on wasm32 is a different call signature than the variadic function has. 3.14.2-16 fixes the first case (`patches/libffi-wasix-varargs.patch`, `cert/ctypes-varargs.mjs`); the second stays wrong by the ABI, as on Apple arm64.

## 3.14.2-15 `_ctypes` / ImportError→OSError (homescoop#110)

**-15 on a kernel without the dlopen(NULL)=main fix (e.g. 1.49.0):**
`import ctypes` raises OSError at ctypes/__init__.py:565
(`pythonapi = PyDLL(None)` → "dlopen() error"). numpy/_core/_internal.py
imports ctypes under `except ImportError`, so `import numpy` fails, and with
it every py-* package that imports numpy (pandas, scipy, matplotlib, …).
Measured in cert/sidemods.mjs, run 38088989164. **-14 is unaffected**
(ImportError, caught).

**Second example — huggingface_hub / `hf`:** **-15 on 1.49.0:** `import ctypes`
raises OSError (`dlopen(NULL)`); hf fails. **-14:** hf fails with
`ModuleNotFoundError` (no `_ctypes`; huggingface_hub 2.2.0's `_terminal.py`
does a bare top-level `import ctypes`).

**Floor:** slicc-kernel **1.51.0** (`engines` `>=1.51.0`, `cert/meta.json`
`kernel` `@ai-ecoverse/slicc-kernel@1.51.0`) — r99's #316 (`dlopen(NULL)` /
own path / symlink = main + `closure_prepare`). npm/pnpm treat `engines` as
advisory, so the catalog moves python to -15 with the kernel bump.
`cert/sidemods.mjs` on ≥1.51.0 gates the py-* re-pin wave.

A homescoop remap of `dlopen(None)` → `bin/python.wasm` was tried and
**rejected** (second PIE load; `Py_IsInitialized` would be 0). Not `_slicc_site`.

## 3.14.2-15 py-* discovery (no PYTHONPATH)

- **3.14.2-14** finds no py-* package by itself: `import numpy` is
  `ModuleNotFoundError` unless `PYTHONPATH` lists every `site-packages`
  (cert/sidemods.mjs set it until -15). With pnpm 12, even that is hard:
  `pnpm add -g a b` makes one global project per package, and the
  transitive py-* (py-numpy under py-pandas, …) are only in each project's
  `.pnpm` store.
- **Not picked up, by design** (cert/discovery.mjs checks the first):
  a py-* whose `wasix-python` (Node's lookup from its real directory) is
  another version, e.g. one built for 3.14.2-13 next to a 3.14.2-15 python
  (`python -v`: "skip …: built for wasix-python 3.14.2-13, this is
  3.14.2-15"); a py-* whose `requires` abi/platform differ; a py-* in
  another (non-pnpm-global) project; a second copy of a name already found.
  Packages in a venv without `--system-site-packages` are not added.
- `.pth` files inside a py-* `site-packages` are not run (as with
  `PYTHONPATH`); no published py-* has one.
- **The re-pin wave must ship with -15.** Published py-* that pin
  wasix-python exactly (py-numpy 2.3.2-7: `3.14.2-13`) bring their own
  nested copy; next to a 3.14.2-15 python, discovery refuses them by design
  (browser cert run 38092730025: "skip @ai-ecoverse/py-numpy 2.3.2-7: built
  for wasix-python 3.14.2-13, this is 3.14.2-15", and numpy was not
  importable without PYTHONPATH). Caret-ranged older py-* resolve to the
  top-level python and are taken. cert/discovery.mjs asserts that refusal,
  then re-pins (fixtures/repin.mjs) for the rest of the cert.
- 5ae7f67d's discover() shadowed its JSON scanner with `_scan()` and
  parsed every package.json through `json.loads` after an exception (works,
  but imports json/re at startup); its cache did not cover the pythons the
  py-* resolved to (a moved nested copy kept a stale refusal). Both fixed.

# Negative proof (wasix-python 3.14.2-10 / -11 venvs)

## 3.14.2-11 (homescoop#157), slicc-kernel 1.30.0's Node entry

- **3.14.2-10** fails the chained-sitecustomize case: `import sitecustomize`
  returns ours, not the user's (#157 b).
  ```
  + '1 /node_modules/@ai-ecoverse/wasix-python/lib/python3.14/sitecustomize.py\n'
  - '1 /home/v/lib/python3.14/site-packages/sitecustomize.py\n'
  ```
- **-11 without `site-packages/slicc-executable.pth`**: a sitecustomize on
  PYTHONPATH shadows the stdlib one and sys.executable stays '' (#157 c).
  ```
  + ' 1\n'
  - '/usr/bin/python 1\n'
  ```
- **-11 without `os.path.abspath`** in `_slicc_site.py`: `PATH=.` in
  /usr/bin gives a relative executable (#157 a).
  ```
  + './python\n'
  - '/usr/bin/python\n'
  ```

**Date:** 2026-10-09
Not in `scripts/ci-certified.json`; venv support needs human cert.

## 3.14.2-9 (no sitecustomize.py)

On a kernel with the slicc-kernel#168 prototype, the first case fails:

```
+ '  True\n'
- '/usr/bin/python /usr/bin/python True\n'
```

## Kernel without slicc-kernel#168

-10 on stock slicc-kernel 1.26.4: the venv's python starts with argv[0]
`python`, so it runs as the base interpreter:

```
+ '/node_modules/@ai-ecoverse/wasix-python/ /usr/bin/python False\n'
- '/home/v /home/v/bin/python True\n'
```

## Spec non-vacuous

Exact sys.prefix/sys.executable strings for base and venv, where pip put
requests (venv site-packages, not the user site, not the base), a console
script and a subprocess inside the venv, and a chained user sitecustomize.

## 3.14.2-18: negative 3.14.2-17 (homescoop#296)

3.14.2-17 (PR #300's artifact, sha256 53318842…) on slicc-kernel 1.77.0's Node entry, 2026-10-14: `ctypes.CDLL(None).fork()` prints `fork 0 1008` once and the process dies with `python: wasm trap: unreachable` (rc 134); `round17.mjs`'s new assertion fails with `['fork', '_Fork', '_fork_internal', '__vfork_internal', '__wasi_proc_fork', '__wasi_proc_fork_env'] False True 3`. `system()` and `popen()` through ctypes work (rc 0).


## 3.14.2-19: negative 3.14.2-18 (homescoop#340, #343)

3.14.2-18 (published, sha256 5ef04fe2…7c06) on slicc-kernel 1.92.0's Node entry, 2026-10-15: `notices.mjs` fails: its `THIRD-PARTY-NOTICES.md` is the 1083-byte table, and every licence text is missing (`CPython incorporated software`, `OpenSSL Apache-2.0`, `zlib`, `bzip2`, `xz 0BSD`, `SQLite`, `GNU Readline GPL-3.0`, `ncurses`, `libffi`, `wasix-libc musl`, `libc++`, …, `GPL combined work`). `stdlib.mjs` fails on `sqlite3.sqlite_version` 3.53.4 against 3.54.0.

`sigmask.mjs` (wasix-sysroot -28) fails on 3.14.2-18 (sysroot -27, slicc-kernel 1.93.0 Node entry): its first `signal.pthread_sigmask(SIG_BLOCK, {SIGUSR1})` raises `OSError(0, 'Error')`, rc 1.

## 3.14.2-22: engines >= 1.100.0 (homescoop#567)

cert-review of #530's first head (05b81d7e) found that on slicc-kernel 1.99.2, which the old `engines` (>=1.51.0) admitted, two python processes on one database lost an acknowledged row. B's insert returned ok, A's commit got `disk I/O error`, and the table ended `[0, 1]`. The cause is that the unix VFS takes `fcntl` locks, and without `slicc.fcntl_lock` the libc grants them locally. `engines` is now `>=1.100.0`. `locks.mjs` no longer accepts local locks (the `PY_LOCKS_LOCAL=1` branch is gone), so on 1.99.2 it fails at `another process got LOCK_EX while this one held it` instead of passing.

## 3.14.2-23: negative 3.14.2-21/-22 (homescoop#515, #516, #587, #621)

The published 3.14.2-21 (npm sha512-JZN9ayQh…) on slicc-kernel 1.100.4's Node entry, 2026-10-16. -22 changes only sqlite's VFS, so it behaves the same here.

- **`mp-listener.mjs` fails at `close()`.** The Client/Listener round trip on the AF_UNIX path works, then `Listener.close()` raises `FileNotFoundError: [Errno 44] No such file or directory: '/tmp/…/listener'`, because the kernel never put the path in the filesystem (slicc-kernel#753). The same -21 with `cpython-multiprocessing-unix-listener-wasix.patch` applied to its `connection.py` passes. `multiprocessing.Manager()` fails earlier still, with `TypeError: str, bytes or bytearray expected, not int`: libc's `getsockname` returns `(0, b'')` for AF_UNIX. That part waits for wasix-sysroot -31.
- **`mp-limits.mjs` fails on its first assertion.** Its output on -21:
  ```
  {"methods": ["spawn", "fork", "forkserver"], "start": "spawn", "fork": ["ok", "fork"],
   "forkserver": ["ValueError", "forkserver start method not available"],
   "value": [["ok", 0], 1, [1, 2]], "threads": 400, "shm": ["ok", "psm_3c00c7ba"],
   "has_shmem": true, "executor": [0, 1, 8, 27, 64]}
  ```
  The child's `v.value += 5` and `a[0] = 9` are lost silently (start() and exit 0, the parent still sees 1 and [1, 2]). `shared_memory` imports and creates a segment, and the resource tracker then warns about a leaked shared_memory object at shutdown.
- **`native-id.mjs` fails at its first assertion.** On -21 `hasattr(threading, "get_native_id")` is False, and the scipy part (`scipy.fft.set_backend("scipy")`, py-scipy 1.18.0-11) raises `AttributeError: module 'threading' has no attribute 'get_native_id'` (homescoop#587). With `get_native_id` monkeypatched in, the same scipy calls give fft `[6, -1.5+0.866j, -1.5-0.866j]`, so the rest of the spec doesn't depend on anything else.
- **`sqlite-vfs.mjs` (#621) fails on -21** (unix-dotfile VFS, slicc-kernel 1.102.5 Node entry). The sibling connection can't even read while the first one holds `BEGIN IMMEDIATE`: `select count(*)` raises `sqlite3.OperationalError: database is locked` (rc 1), because the dotfile lock shuts out readers too. Forcing the unix VFS on the same -21 binary (`file:…?vfs=unix`, which -22 made the default) passes every case.
