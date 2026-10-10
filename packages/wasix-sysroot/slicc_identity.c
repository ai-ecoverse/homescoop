/*
 * SLICC process credentials (wasix-sysroot -20, homescoop#207): user and
 * group ids come from slicc-kernel (K1, slicc-kernel#251) through the
 * `slicc` module's cred_get/cred_set/groups_get/groups_set. There is no
 * fallback: on a kernel without them (ENOSYS) the getters return -1 and the
 * setters fail with ENOSYS. Names come from the kernel's real /etc/passwd
 * and /etc/group through musl's own getpw and getgr code.
 *
 * Replaces wasix-libc's getuid/geteuid/getgid/getegid (always 0) and the
 * cloudlibc setuid/seteuid/setgid/setegid (no-ops) and setgroups (ENOTSUP).
 */
#define _GNU_SOURCE
#include <errno.h>
#include <grp.h>
#include <stdint.h>
#include <unistd.h>

#define SLICC(name) __attribute__((import_module("slicc"), import_name(#name)))
/* out: ruid, euid, suid, rgid, egid, sgid */
SLICC(cred_get) int32_t __slicc_cred_get(uint32_t *out);
/* -1 keeps an id; the kernel applies the POSIX rules (EPERM, EINVAL). */
SLICC(cred_set) int32_t __slicc_cred_set(int32_t ruid, int32_t euid, int32_t suid,
                                         int32_t rgid, int32_t egid, int32_t sgid);
/* cap 0: count only; 0 < cap < count: EINVAL */
SLICC(groups_get) int32_t __slicc_groups_get(uint32_t *buf, uint32_t cap, uint32_t *count);
/* root only: EPERM */
SLICC(groups_set) int32_t __slicc_groups_set(const uint32_t *buf, uint32_t count);

enum { RUID, EUID, SUID, RGID, EGID, SGID };

static uint32_t cred(int which) {
  uint32_t c[6];
  if (__slicc_cred_get(c) != 0) return (uint32_t)-1;
  return c[which];
}

static int ret(int32_t err) {
  if (err == 0) return 0;
  errno = err;
  return -1;
}

static int set(int32_t ruid, int32_t euid, int32_t suid,
               int32_t rgid, int32_t egid, int32_t sgid) {
  return ret(__slicc_cred_set(ruid, euid, suid, rgid, egid, sgid));
}

uid_t getuid(void) { return cred(RUID); }
uid_t geteuid(void) { return cred(EUID); }
gid_t getgid(void) { return cred(RGID); }
gid_t getegid(void) { return cred(EGID); }

int getresuid(uid_t *r, uid_t *e, uid_t *s) {
  uint32_t c[6];
  int32_t err = __slicc_cred_get(c);
  if (err) return ret(err);
  *r = c[RUID]; *e = c[EUID]; *s = c[SUID];
  return 0;
}

int getresgid(gid_t *r, gid_t *e, gid_t *s) {
  uint32_t c[6];
  int32_t err = __slicc_cred_get(c);
  if (err) return ret(err);
  *r = c[RGID]; *e = c[EGID]; *s = c[SGID];
  return 0;
}

int getgroups(int n, gid_t list[]) {
  uint32_t count = 0;
  if (n < 0) return ret(EINVAL);
  int32_t err = __slicc_groups_get((uint32_t *)list, (uint32_t)n, &count);
  if (err) return ret(err);
  return (int)count;
}

int setgroups(size_t n, const gid_t list[]) {
  if (n > UINT32_MAX) return ret(EINVAL);
  return ret(__slicc_groups_set((const uint32_t *)list, (uint32_t)n));
}

int setresuid(uid_t r, uid_t e, uid_t s) { return set(r, e, s, -1, -1, -1); }
int setresgid(gid_t r, gid_t e, gid_t s) { return set(-1, -1, -1, r, e, s); }
int seteuid(uid_t e) { return set(-1, e, -1, -1, -1, -1); }
int setegid(gid_t e) { return set(-1, -1, -1, -1, e, -1); }

/* Linux: privileged sets all three ids, anyone else only the effective one. */
int setuid(uid_t u) {
  return cred(EUID) == 0 ? set(u, u, u, -1, -1, -1) : set(-1, u, -1, -1, -1, -1);
}

int setgid(gid_t g) {
  return cred(EUID) == 0 ? set(-1, -1, -1, g, g, g) : set(-1, -1, -1, -1, g, -1);
}

/* Linux: the saved id becomes the new effective id when the real id is set
 * or the effective id is set to something other than the old real id. */
int setreuid(uid_t r, uid_t e) {
  uint32_t c[6];
  int32_t err = __slicc_cred_get(c);
  if (err) return ret(err);
  int32_t s = -1;
  if (r != (uid_t)-1 || (e != (uid_t)-1 && e != c[RUID])) s = e != (uid_t)-1 ? (int32_t)e : (int32_t)c[EUID];
  return set(r, e, s, -1, -1, -1);
}

int setregid(gid_t r, gid_t e) {
  uint32_t c[6];
  int32_t err = __slicc_cred_get(c);
  if (err) return ret(err);
  int32_t s = -1;
  if (r != (gid_t)-1 || (e != (gid_t)-1 && e != c[RGID])) s = e != (gid_t)-1 ? (int32_t)e : (int32_t)c[EGID];
  return set(-1, -1, -1, r, e, s);
}
