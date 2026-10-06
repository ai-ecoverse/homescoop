/*
 * Link with -Wl,--wrap=getuid,--wrap=geteuid,--wrap=getgid,--wrap=getegid
 * so these win over wasix-libc's return-0 implementations (which otherwise
 * beat a plain multiply-defined .o because -lc is whole-archived first).
 *
 * SLICC realm owns files as uid/gid 1000; match Emscripten's slicc_libc_gaps.
 */
#include <unistd.h>

#define SLICC_UID ((uid_t)1000)
#define SLICC_GID ((gid_t)1000)

uid_t __wrap_getuid(void) { return SLICC_UID; }
uid_t __wrap_geteuid(void) { return SLICC_UID; }
gid_t __wrap_getgid(void) { return SLICC_GID; }
gid_t __wrap_getegid(void) { return SLICC_GID; }
