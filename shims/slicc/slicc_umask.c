/* umask through a JS syscall import, so slicc's kernel sees it.
 *
 * Emscripten 4.0.23 implements __syscall_umask in wasm: a weak definition in
 * system/lib/libc/emscripten_syscall_stubs.c that keeps the mask in a wasm
 * global. Earlier releases imported it from JS (env.__syscall_umask), and
 * slicc-kernel wraps that import (process-fds.ts kernelUmask, #208): the
 * kernel's per-process umask, inherited by children and applied to their
 * creates. With the wasm stub, `umask 077` in bash never reached the kernel
 * (homescoop: wasm-bash 5.3.0-8/-9 lost the import).
 *
 * This strong definition overrides the weak stub and calls the JS function
 * __syscall_umask (slicc-fork.js), which the kernel wraps when present.
 * Link it whole-archive (homescoop_slicc_link_archive) so it wins.
 */
__attribute__((import_module("env"), import_name("__syscall_umask")))
int __slicc_syscall_umask_js(int mask);

int __syscall_umask(int mask) {
  return __slicc_syscall_umask_js(mask);
}
