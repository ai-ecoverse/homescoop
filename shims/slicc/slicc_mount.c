/*
 * mount(2) / umount2(2) for Emscripten tools running in slicc
 * (slicc-kernel#92, homescoop#62).
 *
 * The kernel mounts on the process's behalf (`Module.sliccKernel.mount` /
 * `umount2`), with the same drivers as the embedder's `kernel.mount`: tmpfs,
 * fsa, hostfs and installed types. Both calls are synchronous and return
 * 0 or -errno in Emscripten numbering; a relative target resolves against
 * FS.cwd() inside the runtime. Emscripten has no mount syscall of its own,
 * and outside the wasm realm (or on a kernel before #92) these give ENOSYS.
 *
 * All three entry points are strong so musl's src/linux/mount.c is never
 * pulled in next to them.
 */
#include <emscripten.h>
#include <errno.h>
#include <sys/mount.h>

EM_JS_DEPS(slicc_mount, "$UTF8ToString");

EM_JS(int, slicc_mount_js,
      (const char *source, const char *target, const char *fstype, unsigned flags, const char *data), {
  const k = Module.sliccKernel;
  if (!k || !k.mount) return -52; // ENOSYS
  const str = (p) => (p ? UTF8ToString(p) : '');
  return k.mount(str(source), str(target), str(fstype), flags >>> 0, str(data));
});

EM_JS(int, slicc_umount2_js, (const char *target, int flags), {
  const k = Module.sliccKernel;
  if (!k || !k.umount2) return -52; // ENOSYS
  return k.umount2(target ? UTF8ToString(target) : '', flags >>> 0);
});

static int status(int r) {
  if (r < 0) {
    errno = -r;
    return -1;
  }
  return 0;
}

int mount(const char *source, const char *target, const char *fstype, unsigned long flags,
          const void *data) {
  return status(slicc_mount_js(source, target, fstype, (unsigned)flags, (const char *)data));
}

int umount2(const char *target, int flags) {
  return status(slicc_umount2_js(target, flags));
}

int umount(const char *target) {
  return umount2(target, 0);
}
