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
rsync:// works over the kernel's sockets (3.4.4-3): `rsync --daemon` on a
kernel port, and clients to it or, with seven's tailnet, to tailnet names.
Remote shells (`-e ssh`) need an ssh client in the realm.

Built without OpenSSL, xxhash, zstd, lz4, iconv, ACLs or xattrs (bundled zlib
and popt). Error messages print Emscripten's errno numbers (`No such file or
directory (44)` where Linux prints `(2)`).

**From 3.4.4-2 on, rsync requires slicc-kernel ≥ 1.29.2.** `-a` preserves symlinks' own
mtimes, as upstream rsync does, through `utimensat(AT_SYMLINK_NOFOLLOW)`.
Older kernels followed the link there (slicc-kernel#170) and stamped the
link's mtime onto its target, even a file in the source tree; stay on
3.4.4-1 below 1.29.2, which never sets link times (`-J`).

On a hostfs folder (a folder of the user's machine mounted through
slicc-node), the host cannot set a symlink's own time, and on a macOS host
not its mode either. rsync still copies files, links and link targets
correctly (targets keep their times), but it warns (`failed to set times on
…: Not supported`) and exits 23, and a re-run itemizes those links again
(`.L..tp`).

Certified on `@ai-ecoverse/slicc-kernel` 1.30.0.
