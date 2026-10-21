# `@ai-ecoverse/wasm-util-linux`

The text tools from [util-linux](https://github.com/util-linux/util-linux)
2.42.4 for [slicc](https://github.com/ai-ecoverse/slicc)'s wasm realm:
`rev`, `column`, `hexdump`, `colrm`, `look`, `getopt` and `flock`.

```bash
pnpm add -g @ai-ecoverse/wasm-util-linux
printf 'abc\n' | rev
column -t -s, data.csv
hexdump -C file.bin
eval set -- "$(getopt -o ab: --long alpha,beta: -- "$@")"
```

`mount` and `umount` are in `@ai-ecoverse/wasm-mount`, not here. `col` is
not included.

## 2.42.4-7: flock -F, flock --verbose, notices (homescoop#1465, #1500, #1466; 2026-10-21)

- `flock -F` (`--no-fork`) runs the command in place of flock, as upstream: it holds the lock while it runs, and flock's exit status is the command's. Up to 2.42.4-6 it failed every command with `Exec format error` (rc 69), because libtool moved the slicc shims archive out of `--whole-archive`, so `execvp` reached Emscripten's ENOEXEC stub instead of the shims' `execve`. The archive now goes to the linker as `-Wl,<archive>`, which libtool leaves in place, and the build fails unless the `flock` link line keeps the archive inside `--whole-archive` and `flock.wasm` imports the shims' `slicc_execve_js`, `slicc_exec_wait_js` and `slicc_spawn_capture_js` (`check-flock-imports.mjs`) (#1465, #1468).
- `flock --verbose` reports how long getting the lock took. It said `0.000000 seconds` after any wait, because `CLOCK_MONOTONIC_RAW` fails under Emscripten; `flock-slicc.patch` now times it with `CLOCK_MONOTONIC`, like `-w` (#1500).
- `THIRD-PARTY-NOTICES.md` carries the copyright and permission notices from the head of each program's main source file (`rev.c`, `column.c`, `hexdump.c`, `colrm.c`, `look.c`, `getopt.c` and `flock.c`), so `flock.c`'s MIT notice (H. Peter Anvin) ships with `flock.wasm`, and each BSD notice names its own holder and years (#1466, #1469).
- util-linux is off `scripts/reproducible-pending.json`: ladder-pr rebuilds it and compares the tarballs (#808).

## 2.42.4-5: flock (homescoop#977; 2026-10-20)

`flock` is new. It wraps a command, or the `-c` string, in a lock. Use `-n` to fail at once (rc 1, or the `-E` code), `-w SECONDS` to give up after a timeout, or neither to wait. `-s`, `-x`, `-u`, `-o` and `-F` work as upstream (`-F` from 2.42.4-7). The lock is the kernel's flock table, held per open file across processes, so this needs a slicc-kernel with that table (1.132.1 is certified; 1.102.6 has none, and the lock is never contended). In slicc, `flock-slicc.patch` starts the command with `posix_spawnp`, because there is no `fork()`. It also polls a non-blocking lock for `-w`, because a JS `setitimer` can't interrupt a blocking `flock()`.

The README no longer names a cert kernel, which went stale whenever `cert/meta.json` moved (homescoop#847).

