# `@ai-ecoverse/wasm-mount`

`mount` and `umount` for [slicc](https://github.com/ai-ecoverse/slicc)'s wasm
realm. Processes mount through the kernel's own drivers (tmpfs, fsa, hostfs,
installed types).

```bash
pnpm add -g @ai-ecoverse/wasm-mount
mkdir -p /mnt/scratch /mnt/f
mount -t tmpfs -o maxfile=1g none /mnt/scratch
mount -t fsa none /mnt/f        # empty ("nomedium") until "Insert folder" in the page
mount                           # list /proc/mounts
umount /mnt/scratch
umount -l /mnt/f                # detach even if busy
```

- `mount [-l] [-t type]` lists mounted filesystems.
- `mount [-frwv] [-t type] [-o options] <source> <directory>` mounts (`-f` fakes it). `ro`/`rw`
  set read-only; other options go to the driver (`maxfile=1g`, …).
- `umount [-lfv] <directory>|<source>...` unmounts; `-l`/`-f` detach at once.

Remount, bind and move mounts, `mount -a` and fstab lookups are not supported.
The flags are a subset of util-linux's, with the same spellings and the same
listing format. Exit codes follow util-linux: 1 for usage, 32 for mount failure.

Requires an `@ai-ecoverse/slicc-kernel` with process mounts (slicc-kernel#92);
older kernels answer "mount(2) is not available".
