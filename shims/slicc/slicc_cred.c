#include <emscripten.h>
#include <errno.h>
#include <stddef.h>
#include <sys/types.h>

// Who the program runs as: the process credentials slicc-kernel keeps
// (homescoop#207, slicc-kernel K1): Module.sliccKernel.cred() returns
// { ruid, euid, suid, rgid, egid, sgid, groups } and setcred(change) applies
// the POSIX rules (EPERM, EINVAL). There is no fallback: on a kernel without
// them the getters return -1 and the setters fail with ENOSYS. Emscripten
// answers 0 for every id and EPERM for every set*id on its own.
#include <unistd.h>
#include <grp.h>

// out: ruid, euid, suid, rgid, egid, sgid. 0, or a negative errno.
EM_JS(int, slicc_cred_js, (unsigned *out), {
  const k = Module.sliccKernel;
  if (!k || !k.cred) return -52; // ENOSYS
  const c = k.cred();
  if (typeof c === 'number') return c;
  ['ruid', 'euid', 'suid', 'rgid', 'egid', 'sgid'].forEach((key, i) => { HEAPU32[(out >> 2) + i] = c[key] >>> 0; });
  return 0;
});

// The supplementary groups into list (cap entries; cap 0 counts them).
EM_JS(int, slicc_groups_js, (unsigned *list, int cap), {
  const k = Module.sliccKernel;
  if (!k || !k.cred) return -52; // ENOSYS
  const c = k.cred();
  if (typeof c === 'number') return c;
  if (cap === 0) return c.groups.length;
  if (cap < c.groups.length) return -28; // EINVAL
  c.groups.forEach((g, i) => { HEAPU32[(list >> 2) + i] = g >>> 0; });
  return c.groups.length;
});

// -1 keeps an id. 0, or a negative errno.
EM_JS(int, slicc_setcred_js, (int ruid, int euid, int suid, int rgid, int egid, int sgid), {
  const k = Module.sliccKernel;
  if (!k || !k.setcred) return -52; // ENOSYS
  const change = {};
  const ids = { ruid, euid, suid, rgid, egid, sgid };
  for (const key in ids) if (ids[key] !== -1) change[key] = ids[key] >>> 0;
  const r = k.setcred(change);
  return typeof r === 'number' ? r : 0;
});

EM_JS(int, slicc_setgroups_js, (const unsigned *list, int n), {
  const k = Module.sliccKernel;
  if (!k || !k.setcred) return -52; // ENOSYS
  const groups = [];
  for (let i = 0; i < n; i++) groups.push(HEAPU32[(list >> 2) + i]);
  const r = k.setcred({ groups });
  return typeof r === 'number' ? r : 0;
});

enum { SLICC_RUID, SLICC_EUID, SLICC_SUID, SLICC_RGID, SLICC_EGID, SLICC_SGID };

static unsigned slicc_cred_one(int which) {
  unsigned c[6];
  return slicc_cred_js(c) == 0 ? c[which] : (unsigned)-1;
}

static int slicc_status(int r) {
  if (r < 0) {
    errno = -r;
    return -1;
  }
  return r;
}

static int slicc_setcred(int ruid, int euid, int suid, int rgid, int egid, int sgid) {
  return slicc_status(slicc_setcred_js(ruid, euid, suid, rgid, egid, sgid));
}

EMSCRIPTEN_KEEPALIVE unsigned slicc_cred_euid(void) { return slicc_cred_one(SLICC_EUID); }

uid_t __syscall_getuid32(void) { return slicc_cred_one(SLICC_RUID); }
uid_t __syscall_geteuid32(void) { return slicc_cred_one(SLICC_EUID); }
gid_t __syscall_getgid32(void) { return slicc_cred_one(SLICC_RGID); }
gid_t __syscall_getegid32(void) { return slicc_cred_one(SLICC_EGID); }

int __syscall_getresuid32(uid_t *ruid, uid_t *euid, uid_t *suid) {
  unsigned c[6];
  int r = slicc_cred_js(c);
  if (r < 0) return r;
  *ruid = c[SLICC_RUID]; *euid = c[SLICC_EUID]; *suid = c[SLICC_SUID];
  return 0;
}

int __syscall_getresgid32(gid_t *rgid, gid_t *egid, gid_t *sgid) {
  unsigned c[6];
  int r = slicc_cred_js(c);
  if (r < 0) return r;
  *rgid = c[SLICC_RGID]; *egid = c[SLICC_EGID]; *sgid = c[SLICC_SGID];
  return 0;
}

// Raw syscall convention: the count, or a negative errno.
int __syscall_getgroups32(int size, gid_t *list) {
  if (size < 0) return -EINVAL;
  return slicc_groups_js((unsigned *)list, size);
}

// Emscripten musl routes every set*id through __setxid_emscripten(), which
// always fails with EPERM: these go to the kernel instead.
int setresuid(uid_t r, uid_t e, uid_t s) { return slicc_setcred(r, e, s, -1, -1, -1); }
int setresgid(gid_t r, gid_t e, gid_t s) { return slicc_setcred(-1, -1, -1, r, e, s); }
int seteuid(uid_t e) { return slicc_setcred(-1, e, -1, -1, -1, -1); }
int setegid(gid_t e) { return slicc_setcred(-1, -1, -1, -1, e, -1); }

// Linux: a privileged process sets all three ids, anyone else the effective one.
int setuid(uid_t u) {
  return slicc_cred_one(SLICC_EUID) == 0 ? slicc_setcred(u, u, u, -1, -1, -1)
                                         : slicc_setcred(-1, u, -1, -1, -1, -1);
}

int setgid(gid_t g) {
  return slicc_cred_one(SLICC_EUID) == 0 ? slicc_setcred(-1, -1, -1, g, g, g)
                                         : slicc_setcred(-1, -1, -1, -1, g, -1);
}

// Linux: the saved id becomes the new effective id when the real id is set,
// or the effective id is set to something other than the old real id.
int setreuid(uid_t r, uid_t e) {
  unsigned c[6];
  int err = slicc_cred_js(c);
  if (err < 0) return slicc_status(err);
  int s = -1;
  if (r != (uid_t)-1 || (e != (uid_t)-1 && e != c[SLICC_RUID])) s = e != (uid_t)-1 ? (int)e : (int)c[SLICC_EUID];
  return slicc_setcred(r, e, s, -1, -1, -1);
}

int setregid(gid_t r, gid_t e) {
  unsigned c[6];
  int err = slicc_cred_js(c);
  if (err < 0) return slicc_status(err);
  int s = -1;
  if (r != (gid_t)-1 || (e != (gid_t)-1 && e != c[SLICC_RGID])) s = e != (gid_t)-1 ? (int)e : (int)c[SLICC_EGID];
  return slicc_setcred(-1, -1, -1, r, e, s);
}

int setgroups(size_t size, const gid_t *list) {
  if (size > 65536) {
    errno = EINVAL;
    return -1;
  }
  if (size && !list) {
    errno = EFAULT;
    return -1;
  }
  return slicc_status(slicc_setgroups_js((const unsigned *)list, (int)size));
}
