// Shims for the LLVM-enabled zig, linked against wasi-sdk's wasi-libc.
//
// wasi-libc has no getpid(); C/C++ code that asks for a pid gets the WASIX
// one (proc_id), which SLICC serves.
#include <stdint.h>

__attribute__((import_module("wasix_32v1"), import_name("proc_id")))
uint16_t __homescoop_wasix_proc_id(uint32_t *pid);

int getpid(void) {
  uint32_t pid = 1;
  if (__homescoop_wasix_proc_id(&pid) != 0)
    return 1;
  return (int)pid;
}

// wasi-libc's crt1 `_start` (thread pointer, constructors, preopens) calls
// main; the compiler's Zig code, built without libc, runs from here.
unsigned char __homescoop_zig_main(void);

int main(void) { return __homescoop_zig_main(); }
