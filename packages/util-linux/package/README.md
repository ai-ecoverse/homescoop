# `@ai-ecoverse/wasm-util-linux`

The text tools from [util-linux](https://github.com/util-linux/util-linux)
2.42.4 for [slicc](https://github.com/ai-ecoverse/slicc)'s wasm realm:
`rev`, `column`, `hexdump`, `colrm`, `look` and `getopt`.

```bash
pnpm add -g @ai-ecoverse/wasm-util-linux
printf 'abc\n' | rev
column -t -s, data.csv
hexdump -C file.bin
eval set -- "$(getopt -o ab: --long alpha,beta: -- "$@")"
```

`mount` and `umount` are in `@ai-ecoverse/wasm-mount`, not here. `col` is
not included.

## 2.42.4-5: flock (homescoop#977; 2026-10-20)

`flock` is new. It wraps a command, or the `-c` string, in a lock. Use `-n` to fail at once (rc 1, or the `-E` code), `-w SECONDS` to give up after a timeout, or neither to wait. `-s`, `-x`, `-u`, `-o` and `-F` work as upstream. The lock is the kernel's flock table, held per open file across processes, so this needs a slicc-kernel with that table (1.132.1 is certified; 1.102.6 has none, and the lock is never contended). In slicc, `flock-slicc.patch` starts the command with `posix_spawnp`, because there is no `fork()`. It also polls a non-blocking lock for `-w`, because a JS `setitimer` can't interrupt a blocking `flock()`.

The README no longer names a cert kernel, which went stale whenever `cert/meta.json` moved (homescoop#847).

