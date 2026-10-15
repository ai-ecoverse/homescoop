# Patches to the pinned Emscripten (4.0.23)

`scripts/install-emsdk.sh` installs the pinned Emscripten into a cache directory keyed on the patch set: `<cache>/0.4.0-<id>`, where `<id>` is the first 8 hex digits of a sha256 over the sorted `*.patch` names and their sha256s. With no patches the directory is `<cache>/0.4.0`, as before. Each directory is unpacked fresh from the sha256-pinned archive, every `*.patch` here is applied to its `emscripten/` tree (`patch -p1`), and the prebuilt `libc*.a` is deleted, so emcc rebuilds libc with the patches the first time a build links it. The stamp `.homescoop-emsdk` (`<release hash> patches=<id|none>`) is written only after that, and a directory whose stamp doesn't match is reinstalled from the archive.

So a checkout with a different patch set (an older tag, another branch) gets its own install, and the same host can build both. Removing or changing a patch gives a new directory, never a stale patched one. Caches written before homescoop#358 (stamp = the bare release hash, possibly patched in place) are reinstalled once. `scripts/test-install-emsdk.sh` (in the `slicc-shims` workflow) checks that a patched and an unpatched install live side by side.

The emsdk release stays the same, so a package's code changes only where it links the patched code, and only when that package is next rebuilt. The install path does show up in the wasm's debug strings (the include directories), so a package rebuilt with a patch set present carries `…/emsdk/0.4.0-<id>/…` there instead of `…/emsdk/0.4.0/…`.

## `statx-rdev.patch` (homescoop#324)

`system/lib/libc/musl/src/linux/statx.c`. On Emscripten, `statx()` is always musl's `fstatat()` fallback. That fallback never sets `stx_rdev_major`/`stx_rdev_minor`, and it doesn't clear the caller's `struct statx`, so those fields kept whatever was on the stack. slicc-kernel's `st_rdev` was right (`/dev/null` is 259 = 1:3), but `stat -c %t:%T /dev/null` printed `0:0` and `ls -l` printed varying majors. The patch zeroes the struct and fills both fields from `major()`/`minor()` of `st_rdev`. It's still unfixed upstream at the 4.0.23 tag.

Of our Emscripten packages, only coreutils (`stat`, `ls`) calls `statx`. Of the other recipes whose sources mention it:
- tar's use is an OS/2 macro;
- util-linux's is in libmount and lsfd, which our build disables;
- binutils' is in a ChangeLog.
