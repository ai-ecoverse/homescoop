# wasix-sysroot 2025.9.30-14

## F_SETFD CLOEXEC precedence fix

Upstream wasix-libc `fcntl` F_SETFD used `flags | FD_CLOEXEC ? … : 0`
(`|` before `?:`), so every `F_SETFD` set close-on-exec. Clearing CLOEXEC
on stdio (Perl `$^F`, posix_spawn helpers, …) actually marked 0/1/2
close-on-exec; `exec` then left the new process with no stdio.

Patched object: `patches/fcntl.c` → replaced `fcntl.o` in every shipped
`libc.a` (and host `~/.wasixcc/sysroot`), compiled with wasixcc atomics /
bulk-memory features so `--shared-memory` links succeed.

Note: `-12`/`-13` on npm are not this fix (or lack atomics flags). Use `-14`.

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
