# Negative proof (wasix-perl 5.42.0-17)

**Date:** 2026-10-16

5.42.0-17 is a rebuild on wasix-sysroot 2025.9.30-32 (the install-wasixcc pin). `cert/k108/inherit.mjs` against the published `@ai-ecoverse/wasix-perl@5.42.0-16`, with wasm-bash and wasm-coreutils, on slicc-kernel 1.108.1's Node entry: FAIL at the first case. `under trap '' PIPE USR2, %SIG shows the inherited ignores: undef|undef|undef`. -16's libc (-31) starts its sigaction table at SIG_DFL whatever the process inherited, so perl's `%SIG` can't see a `nohup`/`trap ''` ignore. -32 reads `slicc.sigaction_inherited`, and the case expects `IGNORE|IGNORE|undef`.

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

## 5.42.0-13: negative 5.42.0-12 (wasix-sysroot -28) and -11

The new specs against the published tarballs on slicc-kernel 1.100.3's Node entry (users enforce), 2026-10-16. The -13 artifact of the same run passes all of them on 1.100.3 and on 1.93.0 (locks.mjs takes its no-`slicc.fcntl_lock` branch there).

- **locks.mjs** on 5.42.0-12 fails at once, rc 255: `Your vendor has not defined Fcntl macro F_GETLK, used at -e line 8`. sysroot -28's headers define no record-lock commands, so Fcntl has none.
- **static-xs.mjs** on 5.42.0-12 fails at its first case, rc 255: `Undefined subroutine &DynaLoader::dl_error called at -e line 4.` patches/0004's no-op `boot_DynaLoader` defines nothing else. Without patches/0007 its Encode case gets `Unknown encoding 'UTF-16LE'`, because -12 has no `Encode/Unicode.pm` and no `boot_Encode__Unicode`. -12 is the build without patches/0006 and 0007.
- **sigmask-inherit.mjs** passes on 5.42.0-12, since masks have been real since -12. On 5.42.0-11 (sysroot -27) it gives `forkchild=none execchild=none systemchild=none kept=none after=none qx=hi nested_in_handler=2 total=2`, against `forkchild=10,15 execchild=10,15 systemchild=10,15 kept=10,15 after=none qx=hi nested_in_handler=1 total=2`.
- The 12 older specs pass with -12 on 1.100.3, so moving the cert kernel from 1.93.0 to 1.100.3 changes no older case.

## 5.42.0-14: the engines floor (homescoop#552)

`locks.mjs` against the published 5.42.0-13 on slicc-kernel 1.100.3's Node entry, 2026-10-16: FAIL at `engines.slicc-kernel is >=1.100.0 … : >=1.44.0`. -13 admitted kernels without `slicc.fcntl_lock`, where every lock is granted locally. With -14's manifest over the same files, the spec passes (real locks: child EAGAIN, F_SETLKW waited). The spec has no local-answer branch any more, so it also fails on a kernel before 1.100.0.

## 5.42.0-15: flock (homescoop#631, 2026-10-16)

`cert/flock.mjs` against the published 5.42.0-14 (slicc-kernel 1.100.3): FAIL, `parent=ok ok ok | child=ok ok | blocking=ok:at-once | shared=2`. While the parent holds `LOCK_EX`, the forked child is granted `LOCK_EX|LOCK_NB` and `LOCK_SH|LOCK_NB`, its blocking `LOCK_EX` returns at once, and a writer gets in beside two readers: `wasix-posix-stubs.h` answered every `flock` with success. 5.42.0-15 maps `flock` onto whole-file `fcntl` locks.

## 5.42.0-16: flock on things that aren't regular files (homescoop#757, 2026-10-16)

`cert/flock.mjs` against 5.42.0-15: FAIL, because `flock` on a pipe, STDOUT through a pipe, `/dev/null` or a directory handle fails with EBADF (#757's repro). slicc-kernel keeps record locks on regular files only, and -15 sent every `flock` to `fcntl`. 5.42.0-16 grants `flock` on anything that isn't a regular file, excluding nobody, as -14 and Linux do.

## pod2man / pod2text --help (homescoop#491, 2026-10-16)

`cert/pod.mjs` with the published 5.42.0-14 on slicc-kernel 1.100.3: FAIL, `pod2man --help` exits 0 and prints nothing. pod2usage reads the usage from `$0`, which was a 0-byte `/usr/bin` stub (slicc-kernel#762). On 1.106.2, the cert kernel now, the same tarball passes: the `/usr/bin` entry is the script. The fix is the kernel's; the spec pins it.

## Unix-domain socket addresses (homescoop#767, 2026-10-16)

`run.mjs --package wasix-perl --spec unix-socket.mjs --kernel @ai-ecoverse/slicc-kernel@1.108.4 --users enforce` with the published 5.42.0-17: FAIL, `socket|host=die:Bad arg length for Socket::unpack_sockaddr_un, length is 22, should be 112|unpack=die:…|read=hello peer=die:…`. The socket is created, and a forked client connects and writes its line, but every unpack of the 22-byte address dies. patches/0008 gives `__wasi__` Socket.xs's Linux branch, which takes the short address.

## 5.42.0-19: libc flock and mkfifo (homescoop#758, #765, #878; 2026-10-17)

Against the published 5.42.0-18 on slicc-kernel 1.120.2 (Node entry):
- **`cert/flock.mjs`:** FAIL, `flock on a pipe's two ends (#765): ok granted child-shares after-un-ok`. -18's fcntl emulation grants every lock on a pipe, so the read end's `LOCK_EX|LOCK_NB` is granted while the write end holds `LOCK_EX`. Linux, and -19, give EWOULDBLOCK.
- **`cert/mkfifo.mjs`:** FAIL, `r: No such file or directory`. -18's `mkfifo` is wasix-posix-stubs.h's EOPNOTSUPP stub, so nothing is created.

## 5.42.0-20: Linux file-type bits (homescoop#1015, #752, #682; 2026-10-18)

- **#1015, `file-type-bits.mjs`:** the published 5.42.0-19 on slicc-kernel 1.120.2 under users enforce fails 5 of 6 assertions: `fifo mode=140600 type=140000`, `sock mode=160755 type=160000`, `IFIFO=140000 IFSOCK=160000 IFMT=160000`, while coreutils `stat -c %f` in the same session gives `1180` and `c1ed`. patches/0009 makes perl report Linux's bits and Fcntl's constants Linux's.
- **#682 (AF_UNIX bind 'Success'):** no longer reproduces. `unix-socket.mjs` passes on the published 5.42.0-19 (wasix-sysroot -34, slicc-kernel 1.120.2, users enforce), with bind, listen, connect and accept through `IO::Socket::UNIX`, and hostpath/peerpath equal to the path. sysroot -31 fixed bind, and 5.42.0-18's patches/0008 fixed unpack_sockaddr_un.
- **#752:** 5.42.0-19's description and THIRD-PARTY-NOTICES both name wasix-sysroot 2025.9.30-34. build.sh now fails if the description doesn't name the sysroot it builds on.

## 5.42.0-21: both licence texts, flock lifetimes, Config paths (homescoop#995, #1024, #848; 2026-10-20)

Against the published 5.42.0-20 on slicc-kernel 1.132.1 (the cert kernel), users enforce, `--spec licence.mjs --spec config-paths.mjs --spec flock-lifetime.mjs`:
- **#995, `licence.mjs`:** FAIL, 3 of 6 assertions: `package/LICENSE has no GPL-1.0-or-later text ("GNU GENERAL PUBLIC LICENSE Version 1, February 1989")`, and no `==> Artistic <==` / `==> Copying <==` sections. -20's LICENSE is perl's Artistic file alone, because `homescoop_stage_license` copies only the first candidate that exists. -21 stages both through `homescoop_stage_licenses`.
- **#1024, `flock-lifetime.mjs`:** passes on -20 (`ofd:ex,refused dup:shares | childexit:refused | close:granted | held:refused | kill9:granted | eintr:EINTR`). It guards the behaviour -19 introduced. -18's fcntl emulation granted the second in-process open (`ofd:ex,granted`, the #1024 probes).
- **#848, `config-paths.mjs`:** passes on -20. The fix landed in -19 (#850). On 5.42.0-18, `Config{ccflags}` held `-include /home/runner/work/homescoop/homescoop/packages/wasix-perl/wasix-posix-stubs.h` (#848's diff).
- **Description:** -21's `package.json` description is one plain sentence for bios (Install/Update shows it word for word). The #752 check that the build names its wasix-sysroot moves from the description to the README's `- Built on wasix-sysroot <version> …` line.

## 5.42.0-22: a sized 64 MiB initial heap on wasix-sysroot -42 (homescoop#1287, #819; 2026-10-22)

Against the published 5.42.0-21 on slicc-kernel 1.132.1 (the cert kernel), users enforce, `--spec heap.mjs --spec users.mjs`:
- **#1287, `heap.mjs`:** FAIL, `modules: the wasm memory stays at the 64 MiB initial heap … VmSize peak 22464 kB` (expected 65536). -21 links a 13 MiB initial memory on wasix-sysroot -39, whose dlmalloc ignores the initial pages, so every workload grows the memory: 17.4 MiB (fork), 21.9 (modules), 27.5 (automake-style parse), 43.8 (hash), 84 (the text rewrite). 0 traps there too, since perl is single-threaded; the spec pins that the sized build never calls `memory.grow` in typical use.
- **#819, `users.mjs`:** passes on -21 under enforce (the permission-denial case is new coverage, not a regression). meta.json's new `users: enforce` runs every spec with permission checks; the full -21 suite passes under it except `heap.mjs`.
