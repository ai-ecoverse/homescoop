/* Strong defs for C++ weak TLS symbols so PIE + WASIXCC_INCLUDE_CPP_SYMBOLS
 * does not turn them into env / GOT.func imports (SLICC rejects those).
 *
 * _ZTH5errno must be () -> void (Itanium TLS init); libc++ chrono expects that.
 * __cxa_thread_atexit_impl: libc++abi only provides a weak stub; fall back to
 * process-wide __cxa_atexit (adequate for single DSO python.wasm).
 */
int *__errno_location(void);
int __cxa_atexit(void (*)(void *), void *, void *);

__attribute__((visibility("default")))
void _ZTH5errno(void) {
  (void)__errno_location();
}

__attribute__((visibility("default")))
int __cxa_thread_atexit_impl(void (*func)(void *), void *arg, void *dso) {
  return __cxa_atexit(func, arg, dso);
}
