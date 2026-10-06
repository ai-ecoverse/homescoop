# wasix-perl PRESTAGE (5.42.0-5)

## Systematic d_* sweep (vs one-at-a-time)

Compared every previously-`undef` `d_*` against `llvm-nm --defined-only`
wasix-libc `libc.a` (+ emulated libs). Result in this build's `Config_heavy.pl`:
**375 define / 252 undef** (was ~143 / 481).

Defined whenever the C symbol exists, including the autoreconf blockers and the
requested checklist: `truncate`/`fsync`/`fchmod`/`fchown`/`lchown`/`alarm`/
`getpgrp`/`setpgid`/`killpg`/`poll`/`socketpair`/`uname`/`gethostname`/
`getgroups`(stub)/`getpwent`/`setlocale`/`nl_langinfo`/`access`/`openat`/
`mkstemp`/`link`/`…`.

### Stubs (declared or expected, missing from libc.a)
In `wasix-posix-stubs.h`, soft-fail with `EOPNOTSUPP` (not DIE):
`flock`, `lockf`, `fchdir`, `pause`, `getgroups`, `mkfifo`, `mknod`,
`eaccess`, `futimes`, `chroot`, `getlogin`, `getpriority`, `setpriority`.

Kept undef on purpose: `d_fcntl_can_lock` (no `F_SETLK` in WASI headers),
shadow/`getspnam` (incomplete `struct spwd`), `d_procselfexe`, IPC-ish gaps
that are not in libc, etc.

## Immediate fix for autom4te
`d_truncate=define` → `HAS_TRUNCATE` → `ftruncate`/`truncate` from libc
(no more `truncate not implemented` at `Autom4te/XFile.pm:281`).

## Verified
- `config.h` has `HAS_TRUNCATE`, `HAS_FSYNC`, `HAS_FCHMOD`, `HAS_FLOCK`, …
- Staged tree: `slicc-emscripten/tmp-wasi/staging/wasix-perl` (includes `dev/null`)
- JS WASI host can open files via `path_open2`→`path_open`, but Perl's
  `exit`/`longjmp` still needs a real WASIX `stack_checkpoint` driver
  (SLICC realm). Core `t/op` / `t/io` chunk: run under SLICC, not the stub host.

## SLICC acceptance
```sh
ipk install -g @ai-ecoverse/wasix-perl@5.42.0-5
perl -e 'open my $f,">","/tmp/t"; truncate $f, 0; print "truncate ok\n"'
perl -e 'open my $f,">","/tmp/l"; print flock($f,2) ? "locked" : "flock: $!"'
# undef audit (should not DIE for libc-backed ops):
perl -MConfig -e 'print join "\n", sort grep { /^d_/ && !$Config{$_} } keys %Config'
# then: autoreconf → ./configure → make
```
