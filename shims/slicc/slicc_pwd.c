/*
 * passwd and group lookups for Emscripten programs in slicc: read the
 * kernel's /etc/passwd and /etc/group (real files on slicc-kernel with
 * users; ids come from slicc_libc_gaps.c). Emscripten's libc answers every
 * getpw* / getgr* with "not found", so screen ("getpwuid() can't identify
 * your account!"), ~user expansion and anything that names the user fail.
 *
 * getpwuid, getpwnam and getpwent are strong symbols in Emscripten's
 * emscripten_libc_stubs.o, which is pulled from libc.a whenever a program
 * needs any other stub in it (flock, chroot, ...), so plain definitions here
 * would collide. They are defined as __wrap_* and homescoop_slicc_link_archive
 * links with -Wl,--wrap=getpwuid,... ; every other function here is weak in
 * the stubs and is overridden directly.
 */
#include <errno.h>
#include <grp.h>
#include <pwd.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define LINE_MAX_SLICC 1024

// Split `line` (no newline) at ':' into exactly `n` fields; 0 if malformed.
static int split(char *line, char **f, int n) {
  line[strcspn(line, "\n")] = '\0';
  for (int i = 0; i < n; i++) {
    f[i] = line;
    if (i == n - 1) break;
    char *c = strchr(line, ':');
    if (!c) return 0;
    *c = '\0';
    line = c + 1;
  }
  return 1;
}

// Copy `s` into the caller's buffer; NULL when it does not fit.
static char *put(const char *s, char **out, size_t *left) {
  size_t len = strlen(s) + 1;
  if (len > *left) return NULL;
  char *dst = *out;
  memcpy(dst, s, len);
  *out += len;
  *left -= len;
  return dst;
}

static int fill_pw(char **f, struct passwd *pw, char *buf, size_t buflen) {
  char *out = buf;
  size_t left = buflen;
  if (!(pw->pw_name = put(f[0], &out, &left)) || !(pw->pw_passwd = put(f[1], &out, &left)) ||
      !(pw->pw_gecos = put(f[4], &out, &left)) || !(pw->pw_dir = put(f[5], &out, &left)) ||
      !(pw->pw_shell = put(f[6], &out, &left))) {
    return ERANGE;
  }
  pw->pw_uid = (uid_t)strtoul(f[2], NULL, 10);
  pw->pw_gid = (gid_t)strtoul(f[3], NULL, 10);
  return 0;
}

// The POSIX _r contract: 0 and *res = NULL when not found, an errno value
// (ERANGE for a short buffer) on failure.
static int find_pw(const char *name, uid_t uid, struct passwd *pw, char *buf, size_t buflen,
                   struct passwd **res) {
  *res = NULL;
  FILE *fp = fopen("/etc/passwd", "re");
  if (!fp) return errno == ENOENT ? 0 : errno;
  char line[LINE_MAX_SLICC];
  int rc = 0;
  while (fgets(line, sizeof line, fp)) {
    char *f[7];
    if (!split(line, f, 7)) continue;
    if (name ? strcmp(f[0], name) != 0 : (uid_t)strtoul(f[2], NULL, 10) != uid) continue;
    rc = fill_pw(f, pw, buf, buflen);
    if (rc == 0) *res = pw;
    break;
  }
  fclose(fp);
  return rc;
}

int getpwnam_r(const char *name, struct passwd *pw, char *buf, size_t buflen, struct passwd **res) {
  return find_pw(name, 0, pw, buf, buflen, res);
}

int getpwuid_r(uid_t uid, struct passwd *pw, char *buf, size_t buflen, struct passwd **res) {
  return find_pw(NULL, uid, pw, buf, buflen, res);
}

static struct passwd pw_static;
static char pw_buf[LINE_MAX_SLICC];

static struct passwd *pw_result(int rc, struct passwd *res) {
  if (rc) errno = rc;
  return res;
}

struct passwd *__wrap_getpwnam(const char *name) {
  struct passwd *res;
  return pw_result(getpwnam_r(name, &pw_static, pw_buf, sizeof pw_buf, &res), res);
}

struct passwd *__wrap_getpwuid(uid_t uid) {
  struct passwd *res;
  return pw_result(getpwuid_r(uid, &pw_static, pw_buf, sizeof pw_buf, &res), res);
}

static FILE *pw_ent;

void setpwent(void) {
  if (pw_ent) rewind(pw_ent);
}

void endpwent(void) {
  if (pw_ent) fclose(pw_ent);
  pw_ent = NULL;
}

struct passwd *__wrap_getpwent(void) {
  if (!pw_ent && !(pw_ent = fopen("/etc/passwd", "re"))) return NULL;
  char line[LINE_MAX_SLICC];
  while (fgets(line, sizeof line, pw_ent)) {
    char *f[7];
    if (!split(line, f, 7)) continue;
    int rc = fill_pw(f, &pw_static, pw_buf, sizeof pw_buf);
    if (rc) {
      errno = rc;
      return NULL;
    }
    return &pw_static;
  }
  return NULL;
}

// Groups: name:passwd:gid:member,member,...
static int fill_gr(char **f, struct group *gr, char *buf, size_t buflen) {
  char *out = buf;
  size_t left = buflen;
  if (!(gr->gr_name = put(f[0], &out, &left)) || !(gr->gr_passwd = put(f[1], &out, &left))) return ERANGE;
  gr->gr_gid = (gid_t)strtoul(f[2], NULL, 10);
  char *members = put(f[3], &out, &left);
  if (!members) return ERANGE;
  size_t count = *members ? 1 : 0;
  for (char *c = members; *c; c++) count += *c == ',';
  // The member list follows, aligned for char *.
  uintptr_t at = ((uintptr_t)out + sizeof(char *) - 1) & ~(uintptr_t)(sizeof(char *) - 1);
  size_t pad = at - (uintptr_t)out;
  size_t need = pad + (count + 1) * sizeof(char *);
  if (need > left) return ERANGE;
  char **mem = (char **)at;
  size_t i = 0;
  for (char *m = members; count && m; i++) {
    char *c = strchr(m, ',');
    if (c) *c = '\0';
    mem[i] = m;
    m = c ? c + 1 : NULL;
  }
  mem[i] = NULL;
  gr->gr_mem = mem;
  return 0;
}

static int find_gr(const char *name, gid_t gid, struct group *gr, char *buf, size_t buflen,
                   struct group **res) {
  *res = NULL;
  FILE *fp = fopen("/etc/group", "re");
  if (!fp) return errno == ENOENT ? 0 : errno;
  char line[LINE_MAX_SLICC];
  int rc = 0;
  while (fgets(line, sizeof line, fp)) {
    char *f[4];
    if (!split(line, f, 4)) continue;
    if (name ? strcmp(f[0], name) != 0 : (gid_t)strtoul(f[2], NULL, 10) != gid) continue;
    rc = fill_gr(f, gr, buf, buflen);
    if (rc == 0) *res = gr;
    break;
  }
  fclose(fp);
  return rc;
}

int getgrnam_r(const char *name, struct group *gr, char *buf, size_t buflen, struct group **res) {
  return find_gr(name, 0, gr, buf, buflen, res);
}

int getgrgid_r(gid_t gid, struct group *gr, char *buf, size_t buflen, struct group **res) {
  return find_gr(NULL, gid, gr, buf, buflen, res);
}

static struct group gr_static;
static char gr_buf[LINE_MAX_SLICC * 2];

struct group *getgrnam(const char *name) {
  struct group *res;
  int rc = getgrnam_r(name, &gr_static, gr_buf, sizeof gr_buf, &res);
  if (rc) errno = rc;
  return res;
}

struct group *getgrgid(gid_t gid) {
  struct group *res;
  int rc = getgrgid_r(gid, &gr_static, gr_buf, sizeof gr_buf, &res);
  if (rc) errno = rc;
  return res;
}

// The group database in order (weak stubs in Emscripten, which answer
// "not found" with errno EIO: gnulib's getugroups, behind `id -G USER` and
// `groups USER`, then fails with "I/O error"). The end of the file leaves
// errno alone, as POSIX asks.
static FILE *gr_ent;

void setgrent(void) {
  if (gr_ent) rewind(gr_ent);
}

void endgrent(void) {
  if (gr_ent) fclose(gr_ent);
  gr_ent = NULL;
}

struct group *getgrent(void) {
  if (!gr_ent && !(gr_ent = fopen("/etc/group", "re"))) return NULL;
  char line[LINE_MAX_SLICC];
  while (fgets(line, sizeof line, gr_ent)) {
    char *f[4];
    if (!split(line, f, 4)) continue;
    int rc = fill_gr(f, &gr_static, gr_buf, sizeof gr_buf);
    if (rc) {
      errno = rc;
      return NULL;
    }
    return &gr_static;
  }
  return NULL;
}
