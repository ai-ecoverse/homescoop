# wasix-sysroot 2025.9.30-15

## File ownership (st_uid / st_gid = 1000)

WASI `filestat` has no owner fields, so stock wasix-libc left `st_uid` /
`st_gid` at 0 while `slicc_identity` makes `getuid()`/`getgid()` return 1000.
GnuPG then warns about unsafe homedir ownership; git `safe.directory`, ssh,
and similar checks misbehave the same way.

`slicc_stat_owner.c` replaces `fstat.o` + `fstatat.o` in every shipped
`libc.a` so `stat` / `lstat` / `fstat` / `fstatat` fill uid/gid from
`getuid()`/`getgid()`. `chown` / `fchown` stay upstream no-ops.

Probe (also run by `build.sh` against the packed tarball):

```c
#include <sys/stat.h>
#include <unistd.h>
int main(void) {
  struct stat st;
  if (stat(".", &st) != 0) return 2;
  return (st.st_uid == getuid() && st.st_gid == getgid() && getuid() == 1000) ? 0 : 3;
}
```

## F_SETFD CLOEXEC precedence fix

Upstream wasix-libc `fcntl` F_SETFD used `flags | FD_CLOEXEC ? … : 0`
(`|` before `?:`), so every `F_SETFD` set close-on-exec. Clearing CLOEXEC
on stdio (Perl `$^F`, posix_spawn helpers, …) actually marked 0/1/2
close-on-exec; `exec` then left the new process with no stdio.

Patched object: `patches/fcntl.c` → replaced `fcntl.o` in every shipped
`libc.a` (and host `~/.wasixcc/sysroot`), compiled with wasixcc atomics /
bulk-memory features so `--shared-memory` links succeed.

PRESTAGE (on SLICC):

```c
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
int main(void) {
  if (fcntl(1, F_SETFD, 0) != 0) return 2;
  int f = fcntl(1, F_GETFD);
  if (f != 0) { printf("GETFD=%d\n", f); return 3; }
  execlp("echo", "echo", "exec-ok", (char *)0);
  return 1;
}
```

Must print `exec-ok`.
