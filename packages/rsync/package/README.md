# `@ai-ecoverse/wasm-rsync`

[rsync](https://rsync.samba.org/) 3.4.4 for [slicc](https://github.com/ai-ecoverse/slicc)'s
wasm realm. Local copies only for now:

```bash
pnpm add -g @ai-ecoverse/wasm-rsync
rsync -a --delete src/ dst/
rsync -av --dry-run --exclude='*.log' src/ dst/
rsync -a -c --itemize-changes --stats src/ dst/
```

A local rsync forks a receiver and a generator that talk to the sender over
pipes; on slicc-kernel each is a real process (Emscripten + Asyncify fork).
Remote sync over ssh or the rsync daemon waits for kernel networking.

Built without OpenSSL, xxhash, zstd, lz4, iconv, ACLs or xattrs (bundled zlib
and popt). Error messages print Emscripten's errno numbers (`No such file or
directory (44)` where Linux prints `(2)`).

Symlinks are copied, but their own mtimes aren't preserved (rsync behaves as
if `-J`/`--omit-link-times` were given) until slicc-kernel#170 is fixed:
the kernel's `utimensat(AT_SYMLINK_NOFOLLOW)` follows the link. For the same
reason `--no-omit-link-times`/`--no-J` is refused.

Certified on `@ai-ecoverse/slicc-kernel` 1.26.5.
