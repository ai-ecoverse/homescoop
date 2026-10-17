/* homescoop -33 (homescoop#943): __wasi_proc_raise_interval2 in the PIC trees,
 * as -32 had it from the local -14 base (wasix-python's setitimer libc patch),
 * in the style of wasix-libc's generated __wasixlibc_real.c. libc's own
 * setitimer imports the call privately (patches/setitimer.c); this keeps the
 * public wrapper, and api_wasix.h's declaration, for code that calls it. */
#include <stdint.h>
#include <wasi/api.h>

int32_t __imported_wasix_32v1_proc_raise_interval2(int32_t arg0, int64_t arg1, int64_t arg2, int32_t arg3) __attribute__((
    __import_module__("wasix_32v1"),
    __import_name__("proc_raise_interval2")
));

__wasi_errno_t __wasi_proc_raise_interval2(
    __wasi_signal_t sig,
    __wasi_timestamp_t initial,
    __wasi_timestamp_t interval,
    __wasi_bool_t repeat
){
    int32_t ret = __imported_wasix_32v1_proc_raise_interval2((int32_t) sig, (int64_t) initial, (int64_t) interval, (int32_t) repeat);
    return (uint16_t) ret;
}
