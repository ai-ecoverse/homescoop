# mount / umount (homescoop#62)

In-tree minimal `mount` / `umount` over the process mount ABI from
[slicc-kernel#92](https://github.com/ai-ecoverse/slicc-kernel/issues/92), linked
with the slicc `mount` shim profile (`shims/slicc/slicc_mount.c`).

## Why not util-linux

Measured against util-linux 2.41.2 (`--disable-all-programs --enable-mount`),
built with the same emcc 4.0.23 at `-Oz`:

| | util-linux | this pair |
| --- | --- | --- |
| Source | 9.6 MB tarball; mount+umount 1.8k LOC on libmount 27k + libblkid 23.5k | 565 LOC (incl. shim) |
| wasm | mount 280 KB, umount 274 KB | mount 34 KB, umount 27 KB |
| Port work | lie about the host triple (`mount selected for non-linux system`), fake `linux/version.h`, `sys/inotify.h`, `sys/epoll.h`, `BLK*` ioctl numbers, force-include `sys/mount.h` | none |
| Behaviour gaps | uid ≠ 0 puts libmount in restricted mode (fstab `user` entries only), so plain uid 1000 needs a patch; prefers `/proc/self/mountinfo` (not provided); fork/exec of `/sbin/mount.<type>` helpers | — |

What util-linux adds on top (fstab, LABEL=/UUID= probing via blkid, loop
devices, helpers, remount/bind/move/propagation, utab) is either refused by the
kernel (EINVAL) or meaningless in slicc. libblkid can't be dropped: libmount
requires it at configure time.

## Emscripten, not WASI

Every other homescoop CLI is Emscripten on the host builder, and the
`Module.sliccKernel` EM_JS shim pattern (as in `slicc_jobs.c`) already exists.
A WASI build would need its own toolchain path plus custom `slicc.*` imports
for no gain; the kernel offers both ABIs, so a WASI port stays possible.
