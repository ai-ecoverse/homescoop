#ifndef SLICC_WASI_PWD_H
#define SLICC_WASI_PWD_H
#include <sys/types.h>
#include <errno.h>
struct passwd { char *pw_name; char *pw_passwd; uid_t pw_uid; gid_t pw_gid; char *pw_gecos; char *pw_dir; char *pw_shell; };
static inline int getpwuid_r(uid_t u, struct passwd *p, char *b, size_t n, struct passwd **r) { (void)u;(void)p;(void)b;(void)n; *r = 0; return ENOENT; }
static inline int getpwnam_r(const char *s, struct passwd *p, char *b, size_t n, struct passwd **r) { (void)s;(void)p;(void)b;(void)n; *r = 0; return ENOENT; }
#endif
