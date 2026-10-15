# Patches to the pinned Emscripten (4.0.23)

`scripts/install-emsdk.sh` applies every `*.patch` here to the installed `emscripten/` tree (`patch -p1`), unless it is already applied. After applying one it deletes the prebuilt `libc*.a` from the emsdk cache, so emcc rebuilds libc with the patch the first time a build links it. The emsdk release stays the same, so a package's bytes change only where it links the patched code, and only when that package is next rebuilt.

## `statx-rdev.patch` (homescoop#324)

`system/lib/libc/musl/src/linux/statx.c`. On Emscripten, `statx()` is always musl's `fstatat()` fallback. That fallback never sets `stx_rdev_major`/`stx_rdev_minor`, and it doesn't clear the caller's `struct statx`, so those fields kept whatever was on the stack. slicc-kernel's `st_rdev` was right (`/dev/null` is 259 = 1:3), but `stat -c %t:%T /dev/null` printed `0:0` and `ls -l` printed varying majors. The patch zeroes the struct and fills both fields from `major()`/`minor()` of `st_rdev`. It's still unfixed upstream at the 4.0.23 tag.

Of our Emscripten packages, only coreutils (`stat`, `ls`) calls `statx`. Of the other recipes whose sources mention it:
- tar's use is an OS/2 macro;
- util-linux's is in libmount and lsfd, which our build disables;
- binutils' is in a ChangeLog.
