/* /proc/mounts reader shared by mount and umount (homescoop#62). */
#include "mnt.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>

#ifndef PACKAGE_VERSION
#define PACKAGE_VERSION "dev"
#endif

FILE *mnt_open(void) {
  FILE *f = fopen("/proc/mounts", "r");
  if (!f) f = fopen("/proc/self/mounts", "r");
  return f;
}

/* Undo the kernel's octal escapes (\040 space, \011 tab, \012 nl, \134 \). */
static void unescape(char *s) {
  char *w = s;
  for (char *r = s; *r; r++) {
    if (r[0] == '\\' && r[1] >= '0' && r[1] <= '3' && r[2] >= '0' && r[2] <= '7' && r[3] >= '0' &&
        r[3] <= '7') {
      *w++ = (char)((r[1] - '0') << 6 | (r[2] - '0') << 3 | (r[3] - '0'));
      r += 3;
    } else {
      *w++ = *r;
    }
  }
  *w = '\0';
}

static char *field(char **cursor) {
  char *s = *cursor;
  while (*s == ' ' || *s == '\t') s++;
  if (!*s) return NULL;
  char *end = s + strcspn(s, " \t");
  if (*end) *end++ = '\0';
  *cursor = end;
  unescape(s);
  return s;
}

int mnt_next(FILE *f, struct mnt_entry *e) {
  static char *line;
  static size_t cap;
  while (getline(&line, &cap, f) > 0) {
    line[strcspn(line, "\n")] = '\0';
    char *cur = line;
    e->source = field(&cur);
    e->target = field(&cur);
    e->fstype = field(&cur);
    e->options = field(&cur);
    if (!e->target) continue;
    if (!e->fstype) e->fstype = "";
    if (!e->options) e->options = "";
    return 1;
  }
  return 0;
}

int mnt_has_option(const char *options, const char *word) {
  size_t n = strlen(word);
  for (const char *p = options; p && *p;) {
    const char *end = strchr(p, ',');
    size_t len = end ? (size_t)(end - p) : strlen(p);
    if (len == n && strncmp(p, word, n) == 0) return 1;
    p = end ? end + 1 : NULL;
  }
  return 0;
}

void mnt_version(const char *prog) {
  printf("%s from @ai-ecoverse/wasm-mount %s (slicc)\n", prog, PACKAGE_VERSION);
}
