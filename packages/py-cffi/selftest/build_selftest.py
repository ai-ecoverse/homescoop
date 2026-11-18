# py-cffi's API-mode (out-of-line) fixture: the ffibuilder that build.sh runs
# on the build host (scripts/cffi-wasix.sh: homescoop_cffi_emit, then
# homescoop_cffi_ext), the way a downstream recipe builds its own cffi
# extension (PyNaCl's _sodium, cryptography's _openssl). cert/api.mjs imports
# the result, _cffi_selftest.cpython-315-wasm32-wasix.so.
from cffi import FFI

ffibuilder = FFI()
ffibuilder.cdef(r"""
#define SELFTEST_MAGIC ...
enum color { RED, GREEN = 5, BLUE };
typedef struct { int x; int y; ...; } pt_t;
struct buf { size_t len; unsigned char data[16]; };
static const int selftest_answer;
int pt_dot(pt_t a, pt_t b);
pt_t pt_scale(pt_t p, int k);
size_t buf_fill(struct buf *b, unsigned char v);
long long sum_ll(const long long *a, size_t n);
double avg(const double *a, int n);
int call_twice(int (*f)(int), int x);
int via_python(int x);
extern "Python" int py_hook(int);
extern "Python" void py_note(const char *);
const char *hello(void);
int errno_set(int e);
""")
ffibuilder.set_source("_cffi_selftest", r"""
#include <errno.h>
#include <string.h>
#define SELFTEST_MAGIC 0x5e1f
enum color { RED, GREEN = 5, BLUE };
typedef struct { long pad; int y; int x; } pt_t;   /* cdef says '...': reordered on purpose */
struct buf { size_t len; unsigned char data[16]; };
static const int selftest_answer = 42;
static int py_hook(int);
static void py_note(const char *);
int pt_dot(pt_t a, pt_t b) { return a.x * b.x + a.y * b.y; }
pt_t pt_scale(pt_t p, int k) { p.x *= k; p.y *= k; return p; }
size_t buf_fill(struct buf *b, unsigned char v) { memset(b->data, v, sizeof b->data); b->len = sizeof b->data; return b->len; }
long long sum_ll(const long long *a, size_t n) { long long s = 0; for (size_t i = 0; i < n; i++) s += a[i]; return s; }
double avg(const double *a, int n) { double s = 0; for (int i = 0; i < n; i++) s += a[i]; return n ? s / n : 0; }
int call_twice(int (*f)(int), int x) { return f(f(x)); }
int via_python(int x) { py_note("via_python"); return py_hook(x) * 2; }
const char *hello(void) { return "hello from C"; }
int errno_set(int e) { errno = e; return -1; }
""")

if __name__ == "__main__":
    ffibuilder.emit_c_code("_cffi_selftest.c")
