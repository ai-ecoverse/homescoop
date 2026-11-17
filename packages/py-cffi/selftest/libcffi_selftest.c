/* py-cffi's ABI-mode fixture: a plain C side module (no Python), loaded with
   ffi.dlopen() by cert/abi.mjs. Each function exercises one way cffi calls C
   through libffi: scalars of every width, pointers and arrays, structs by
   value in both directions, callbacks (libffi closures), varargs and a global
   variable. */
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

struct st_point { int x; int y; };
struct st_rect { struct st_point tl; struct st_point br; double scale; };
struct st_one { double v; };

int st_counter = 7;
int st_freed = 0;

int st_add(int a, int b) { return a + b; }
int8_t st_neg8(int8_t a) { return (int8_t)-a; }
uint16_t st_u16(uint16_t a) { return (uint16_t)(a + 1); }
int64_t st_mul64(int64_t a, int64_t b) { return a * b; }
uint64_t st_umax(void) { return UINT64_MAX; }
double st_mix(double a, float b, int c, int64_t d) { return a + (double)b + c + (double)d; }
float st_halve(float f) { return f / 2.0f; }
long double st_ld(long double a) { return a * 2; }

size_t st_strlen(const char *s) { return strlen(s); }
int st_sum(const int *a, size_t n) { int s = 0; for (size_t i = 0; i < n; i++) s += a[i]; return s; }
void st_fill(int *out, size_t n, int start) { for (size_t i = 0; i < n; i++) out[i] = start + (int)i; }
char *st_greet(const char *name, char *buf, size_t n) {
  size_t k = strlen(name);
  if (n < k + 8) return NULL;
  memcpy(buf, "hello, ", 7);
  memcpy(buf + 7, name, k + 1);
  return buf;
}

struct st_point st_mkpoint(int x, int y) { struct st_point p = {x, y}; return p; }
int st_area(struct st_rect r) { return (int)((r.br.x - r.tl.x) * (r.br.y - r.tl.y) * r.scale); }
void st_grow(struct st_rect *r, int k) { r->br.x += k; r->br.y += k; }
struct st_rect st_mkrect(struct st_point a, struct st_point b, double s) { struct st_rect r = {a, b, s}; return r; }
double st_one(struct st_one o) { return o.v * 3; }

int st_apply(int (*cb)(int, void *), int n, void *ud) {
  int s = 0;
  for (int i = 0; i < n; i++) s += cb(i, ud);
  return s;
}
double st_apply_d(double (*cb)(double, double), double a, double b) { return cb(a, b) + 1; }
int st_point_cb(int (*cb)(struct st_point *), int x, int y) { struct st_point p = {x, y}; return cb(&p) + p.x + p.y; }
void st_sort(int *a, size_t n, int (*cmp)(const void *, const void *)) { qsort(a, n, sizeof(int), cmp); }

int st_vsum(int n, ...) {
  va_list ap; int s = 0;
  va_start(ap, n);
  for (int i = 0; i < n; i++) s += va_arg(ap, int);
  va_end(ap);
  return s;
}
double st_vmix(const char *fmt, ...) {
  va_list ap; double s = 0;
  va_start(ap, fmt);
  for (const char *f = fmt; *f; f++) {
    if (*f == 'i') s += va_arg(ap, int);
    else if (*f == 'l') s += (double)va_arg(ap, long long);
    else if (*f == 'd') s += va_arg(ap, double);
  }
  va_end(ap);
  return s;
}

void *st_alloc(size_t n) { return calloc(1, n); }
void st_free(void *p) { free(p); st_freed++; }
