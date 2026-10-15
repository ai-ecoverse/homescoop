# Negative proof (wasix-perl 5.42.0-8)

**Date:** 2026-10-10

The cert specs against the published `@ai-ecoverse/wasix-perl@5.42.0-6` on
slicc-kernel 1.35.1's Node entry (the same transport and peers as the browser
cert):

- **checklist.mjs:** the version, static XS, fork, I/O, @INC and site-install
  cases pass (they pin -6's layout and behaviour). It then fails at the
  DynaLoader marker:
  `'no' !== 'yes'` for `defined &DynaLoader::boot_DynaLoader`. -6 has no
  DynaLoader, so re.pm and Cwd.pm never loaded their XS.
- **regex.mjs:** fails at its first case. `perl -Mre=debug` dies with
  `Undefined subroutine &re::install` (re.pm skips XSLoader without
  DynaLoader).
- **cwd.mjs:** the plain and symlinked directory cases pass with -6's pure-Perl
  Cwd. Inside a tmpfs mount, getcwd and cwd return empty strings:
  `'||/mnt/t/x/y|/mnt/t/x/y/x'`, against `'/mnt/t/x/y|/mnt/t/x/y|…'`.
- **modes.mjs:** `umask 027` is ignored (`old 027`, files 644, directories
  755) because -6's libc predates wasix-sysroot -17's slicc_fs.

-7's own build history (PR #182): `--allow-multiple-definition` hid 7
duplicate regcomp helpers (patches/0003). A make that stopped at the perl
link left List::Util, File::Spec and others out of the package; the staging
check now fails on that.


## utime undef, undef sets 1970 (published 5.42.0-9, wasix-sysroot -20)

`times.mjs` (homescoop#294): 5.42.0-9's `utime undef, undef, $f` calls the libc's `utimes(path, NULL)`, which up to wasix-sysroot -26 sent explicit times 0/0, so the file's mtime becomes 0 instead of now; `times` mixed wall-clock seconds into the CPU fields.

## 5.42.0-7: integer printf formats from the build host

-7 (CI run 38025797225, sha cd123d57…) was configured on the Linux CI host.
perl-cross's configure_pfmt.sh picked `%Ld` for 64-bit IVs there (glibc;
-6, configured on macOS, got `%lld`). musl/wasix-libc rejects `%Ld` for
integers. checklist.mjs against that artifact:

```text
AssertionError [ERR_ASSERTION]: perl -e use Data::Dumper; $Data::Dumper::Useperl = 0; … Dumper([1, {a => 2}, -3, 2**40]): rc=28 stderr=panic: snprintf buffer overflow
```

-8 pins ivdformat, uv{u,o,x,XU}format and sPRI{d,i,u,o,x,XU}64 to `ll` in
hints/wasix; the checklist also asserts the Config values.

## 5.42.0-11: negative 5.42.0-10 (handles.mjs)

`handles.mjs` against the published 5.42.0-10 on slicc-kernel 1.77.0's Node entry, 2026-10-14: FAIL at its first case (`utime` on a filehandle dies, rc 58). Case by case:

```text
utime(1, 2, $fh)                         fail: Not supported
flock($fh, LOCK_EX)                      fail: Not supported
use filetest "access"; -r "/tmp/pa"      not r: Not supported
-r "/tmp/pa" (no pragma)                 r
```

`prove.mjs` against 5.42.0-10: `prove t/a.t` rc 1, `t/a.t (Wstat: 0 Tests: 0 Failed: 0) Parse errors: No plan found in TAP output`, `Result: FAIL`; `perl t/a.t` prints the TAP. `IO::Select->new($out, $err)->can_read(2)` on IPC::Open3 pipes: `perl: wasm trap: memory access out of bounds`, rc 134. `TAP::Parser::Iterator::Process` with `merge => 1` (no select) reads the lines.


## 5.42.0-12: negative 5.42.0-11 (wasix-sysroot -28)

Published 5.42.0-11 (sysroot -27) on slicc-kernel 1.93.0's Node entry, 2026-10-15: `sigmask.mjs` gives `was=0 slept=1 pending=0 blocked_hits=1 masked=0 hits=1 left=0`: `sigprocmask` is ignored, so the self-sent SIGUSR1 runs its handler at once and is never pending. `wasm-mode.mjs` fails: `bin/perl.wasm` is 644.
