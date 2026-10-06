/*
 * SLICC realm identity: uid/gid 1000, user "/home/user".
 * Replaces wasix-libc passwd/uid objects that return 0 / NULL on passwd-less hosts.
 */
#include <errno.h>
#include <grp.h>
#include <pwd.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

#define SLICC_UID ((uid_t)1000)
#define SLICC_GID ((gid_t)1000)

uid_t getuid(void) { return SLICC_UID; }
uid_t geteuid(void) { return SLICC_UID; }
gid_t getgid(void) { return SLICC_GID; }
gid_t getegid(void) { return SLICC_GID; }

static struct passwd slicc_pw = {
    .pw_name = (char *)"user",
    .pw_passwd = (char *)"*",
    .pw_uid = SLICC_UID,
    .pw_gid = SLICC_GID,
    .pw_gecos = (char *)"SLICC User",
    .pw_dir = (char *)"/home/user",
    .pw_shell = (char *)"/bin/sh",
};

static char *slicc_gr_mem[] = {(char *)"user", 0};
static struct group slicc_gr = {
    .gr_name = (char *)"user",
    .gr_passwd = (char *)"*",
    .gr_gid = SLICC_GID,
    .gr_mem = slicc_gr_mem,
};

static int fill_pw(struct passwd *pw, char *buf, size_t size, struct passwd **res) {
  const char *fields[] = {"user", "*", "SLICC User", "/home/user", "/bin/sh"};
  size_t need = 0;
  for (int i = 0; i < 5; i++) need += strlen(fields[i]) + 1;
  if (size < need) {
    *res = 0;
    return ERANGE;
  }
  char *p = buf;
  pw->pw_name = p; strcpy(p, fields[0]); p += strlen(fields[0]) + 1;
  pw->pw_passwd = p; strcpy(p, fields[1]); p += strlen(fields[1]) + 1;
  pw->pw_gecos = p; strcpy(p, fields[2]); p += strlen(fields[2]) + 1;
  pw->pw_dir = p; strcpy(p, fields[3]); p += strlen(fields[3]) + 1;
  pw->pw_shell = p; strcpy(p, fields[4]);
  pw->pw_uid = SLICC_UID;
  pw->pw_gid = SLICC_GID;
  *res = pw;
  return 0;
}

struct passwd *getpwuid(uid_t uid) {
  if (uid != SLICC_UID && uid != 0) return 0;
  return &slicc_pw;
}

struct passwd *getpwnam(const char *name) {
  if (!name) return 0;
  if (strcmp(name, "user") != 0 && strcmp(name, "root") != 0) return 0;
  return &slicc_pw;
}

int getpwuid_r(uid_t uid, struct passwd *pw, char *buf, size_t size, struct passwd **res) {
  if (uid != SLICC_UID && uid != 0) { *res = 0; return 0; }
  return fill_pw(pw, buf, size, res);
}

int getpwnam_r(const char *name, struct passwd *pw, char *buf, size_t size, struct passwd **res) {
  if (!name || (strcmp(name, "user") != 0 && strcmp(name, "root") != 0)) {
    *res = 0;
    return 0;
  }
  return fill_pw(pw, buf, size, res);
}

struct passwd *getpwent(void) { return &slicc_pw; }
void setpwent(void) {}
void endpwent(void) {}

struct group *getgrgid(gid_t gid) {
  if (gid != SLICC_GID && gid != 0) return 0;
  return &slicc_gr;
}

struct group *getgrnam(const char *name) {
  if (!name) return 0;
  if (strcmp(name, "user") != 0 && strcmp(name, "root") != 0) return 0;
  return &slicc_gr;
}

static int fill_gr(struct group *gr, char *buf, size_t size, struct group **res) {
  const char *n = "user";
  size_t need = strlen(n) + 1 + 2 + sizeof(char *) * 2 + sizeof(char *);
  if (size < need) { *res = 0; return ERANGE; }
  char *p = buf;
  gr->gr_name = p; strcpy(p, n); p += strlen(n) + 1;
  gr->gr_passwd = p; strcpy(p, "*"); p += 2;
  while ((uintptr_t)p % sizeof(char *)) p++;
  char **mem = (char **)p;
  mem[0] = gr->gr_name;
  mem[1] = 0;
  gr->gr_mem = mem;
  gr->gr_gid = SLICC_GID;
  *res = gr;
  return 0;
}

int getgrgid_r(gid_t gid, struct group *gr, char *buf, size_t size, struct group **res) {
  if (gid != SLICC_GID && gid != 0) { *res = 0; return 0; }
  return fill_gr(gr, buf, size, res);
}

int getgrnam_r(const char *name, struct group *gr, char *buf, size_t size, struct group **res) {
  if (!name || (strcmp(name, "user") != 0 && strcmp(name, "root") != 0)) {
    *res = 0;
    return 0;
  }
  return fill_gr(gr, buf, size, res);
}

struct group *getgrent(void) { return &slicc_gr; }
void setgrent(void) {}
void endgrent(void) {}
