# @ai-ecoverse/wasix-perl

Perl 5.42 for slicc WASIX (`perl`, `prove`, `pod2man`, `cpan`, `perldoc`).

- Cross-built with [perl-cross](https://github.com/arsv/perl-cross) + wasixcc against wasix-sysroot
- Built on wasix-sysroot 2025.9.30-42 (the asyncify tree, for real fork)
- From wasix-sysroot and slicc-kernel (≥ 1.120.0): user ids, `%SIG` (inherited IGNORE too), signal masks, `flock` (per open file description) and `fcntl` record locks, `mkfifo` and times; file modes via slicc_fs; DynaLoader and all of Encode statically linked
- Core XS (POSIX, Fcntl, Cwd, Digest::*, Encode, Socket, …) statically linked
- `fork` / `system` / backticks via WASIX `proc_fork` (asyncify)
- `PERL5LIB` defaults to package `lib/perl5` plus `~/.local/share/perl5`
- `use re 'debug'` / `'eval'` and XS `Cwd` (`getcwd`, `abs_path`) work since
  5.42.0-7: these modules only load their XS when `DynaLoader::boot_DynaLoader`
  exists (-7 to -12 provided a no-op one; -13 links the real DynaLoader). In -6,
  `perl -Mre=debug` died ("Undefined subroutine &re::install") and `getcwd`
  inside a mount returned an empty string.
- File modes on slicc-kernel ≥ 1.35.1: `umask`, `chmod`, `mkdir` modes and
  File::Temp's 600/700 hold, and `stat` reports them (wasix-sysroot
  slicc_fs, since -17); older kernels leave files 644 and directories 755

## 5.42.0-18: Unix-domain socket addresses

`IO::Socket::UNIX`'s `hostpath` and `peerpath`, and
`Socket::unpack_sockaddr_un` on what `getsockname`, `getpeername` or
`accept` return, give the socket's path. Since wasix-sysroot -31 these
return a Linux-length address (the family, the path and its NUL), and up to
5.42.0-17 Socket.xs accepted only the full 112-byte `sockaddr_un` there and
died with `Bad arg length for Socket::unpack_sockaddr_un`; the sockets
themselves worked (homescoop#767).

## 5.42.0-19: real flock and mkfifo (wasix-sysroot -34; slicc-kernel ≥ 1.120.0)

- **flock** is libc's own `flock(2)`, through slicc-kernel's `slicc.flock`. As on Linux, a lock belongs to the open file description, on any handle: a file, a pipe, a terminal, a socket or a directory.
  - A `dup`ed handle and one a forked child inherits share the lock. A second `open` of the same file, or the other end of a pipe, conflicts.
  - `LOCK_EX` on a read-only handle excludes, so the `flock(DATA, LOCK_EX|LOCK_NB)` single-instance idiom refuses a second instance (homescoop#758). Locks on pipes and STDOUT exclude too (homescoop#765).
  - A handled signal can end a blocking `flock` with EINTR, as on Linux.
  - flock and `fcntl` record locks are separate, as on Linux.
- **mkfifo:** `POSIX::mkfifo` and `mknod` make real FIFOs (`slicc_fs.path_mkfifo`, homescoop#878). Up to -18 they failed with EOPNOTSUPP.
- **Kernel:** this needs slicc-kernel ≥ 1.120.0 (engines).

## 5.42.0-20: Linux file-type bits for FIFOs and sockets

`stat` and `lstat` report a FIFO as `0010000` and a socket as `0140000` in
`(stat)[2]`, as Linux and coreutils `stat -c %f` do, and Fcntl's `S_IFMT`,
`S_IFIFO` and `S_IFSOCK` are Linux's (`0170000`, `0010000`, `0140000`), so
`S_ISFIFO`/`S_ISSOCK` agree with them (homescoop#1015). Up to 5.42.0-19 these
were wasix-libc's values (`0140000` for a FIFO, `0160000` for a socket,
`S_IFMT` `0160000`), so code comparing raw modes with Linux literals was
wrong. `-p` and `-S` are unchanged. The build checks that `package.json`'s
description names the wasix-sysroot it was built on (homescoop#752).

## 5.42.0-21: both licence texts; wasix-sysroot -39

- **Licence:** perl is `Artistic-1.0-Perl OR GPL-1.0-or-later`, and `LICENSE` now carries both texts, perl's `Artistic` and `Copying` (GPL version 1). Up to 5.42.0-20 it held the Artistic text only (homescoop#995).
- **Sysroot:** built on wasix-sysroot 2025.9.30-39, whose `malloc` refreshes a thread's view of grown shared memory (homescoop#1287). perl is single-threaded, so nothing changes for scripts. Since -37 libc's `S_IF*` bits are Linux's too, the values `patches/0009` already gives.
- **flock lifetimes:** a lock belongs to its open file description (since -19). It stays held when a forked child that inherited the handle exits, and is freed when the holder closes its last handle on that description or is killed. `cert/flock-lifetime.mjs` checks each case and EINTR (homescoop#1024).
- **Config:** no `%Config` value names the build machine's paths (since -19; homescoop#848, #850).

## 5.42.0-15 / -16: flock excludes other processes (up to -18)

`flock` takes whole-file `fcntl` record locks (`LOCK_SH` → `F_RDLCK`,
`LOCK_EX` → `F_WRLCK`, `LOCK_UN` → `F_UNLCK`; `LOCK_NB` → `F_SETLK`, else
`F_SETLKW`), which slicc-kernel enforces between processes (homescoop#631).
Up to -14 every `flock` succeeded and excluded nobody, so two autom4te runs
on one `autom4te.cache` raced ("cannot rename autom4te.cache/output.0t").
A refused `LOCK_NB` sets `EWOULDBLOCK`. These are `fcntl` semantics, as
perl's own flock emulation has them: a lock belongs to the process (a forked
child doesn't inherit it, and closing any handle on the file drops it).
`fcntl` wants a writable handle for a write lock and a readable one for a
read lock, so `LOCK_EX` on a read-only handle takes a read lock (other
writers stay out, other read-only `LOCK_EX` holders don't) and `LOCK_SH` on
a write-only one a write lock. So two processes that each `LOCK_EX` a
read-only handle (the `flock(DATA, LOCK_EX|LOCK_NB)` single-instance idiom)
are both granted: open the lock file read-write for exclusion
(homescoop#758). `flock` on something that isn't a regular file (a pipe,
STDOUT on a terminal or pipe, `/dev/null`, a directory) succeeds and
excludes nobody, since slicc-kernel keeps record locks on regular files
only (5.42.0-16; -15 failed it with EBADF, homescoop#757). `lockf` is still
an advisory no-op.

## 5.42.0-14: needs slicc-kernel ≥ 1.100.0

A packaging-only release of 5.42.0-13 (the same files): `engines` now asks
for slicc-kernel ≥ 1.100.0, the first kernel with `slicc.fcntl_lock`. On an
older kernel the libc grants every `fcntl` record lock locally, so two
processes could both hold a write lock on the same bytes and lose data
(homescoop#552). Up to -13 `engines` said ≥ 1.44.0.

The floor is enforced from slicc-kernel 1.106.2 on: its command catalog
refuses a package whose `engines.slicc-kernel` the running kernel doesn't
meet (ai-ecoverse/slicc-kernel#797). Older kernels install the package
without a warning, and there `fcntl` locks, and so `flock`, aren't real:
use slicc-kernel ≥ 1.100.0 (homescoop#651).

From slicc-kernel 1.106.2 the commands' `/usr/bin` entries are the
scripts themselves (slicc-kernel#762), so `pod2man --help` and
`pod2text --help`, which read their usage from `$0`, print it
(homescoop#491); older kernels print nothing there.

## 5.42.0-13: wasix-sysroot 2025.9.30-30

- POSIX record locks: `Fcntl` exports `F_GETLK`, `F_SETLK`, `F_SETLKW` and
  `F_RDLCK`/`F_WRLCK`/`F_UNLCK` (up to -12, `use Fcntl qw(F_SETLK)` died with
  "Your vendor has not defined Fcntl macro F_GETLK"), and `fcntl` takes them to
  slicc-kernel (≥ 1.100.0), which keeps the locks per process, as Linux does: a
  forked child asking for a write lock on a range the parent holds gets
  `EAGAIN`, `F_SETLKW` waits for the unlock, and `F_GETLK` names the holder.
  On an older kernel every lock is granted locally and `F_GETLK` answers
  `F_UNLCK`, so a script that probes `F_SETLK` and falls back now thinks it
  has locking there (hence -14's `engines` floor). The struct is `pack('s s x4 q q l x4', $type, $whence,
  $start, $len, $pid)` (32 bytes on wasm32). `flock` is unchanged: an
  advisory no-op that succeeds on an open handle.
- The real DynaLoader, as upstream builds it for a static perl
  (`dl_none.xs`): `DynaLoader::dl_error` says "Not implemented", and loading
  a module that isn't linked in croaks with "Can't load module …, dynamic
  loading not available in this perl." Up to -12 `boot_DynaLoader` was a
  no-op marker and the `dl_*` functions were missing.
- All of Encode: its XS sub-extensions (`Encode::Unicode`, `Byte`, `Symbol`,
  `EBCDIC`, `CN`, `JP`, `KR`, `TW`) are linked in, so `encode("UTF-16LE", …)`,
  `cp1252`, `koi8-r`, `shiftjis`, `euc-kr`, `big5-eten` and the rest of
  `Encode->encodings(":all")` work. Up to -12 they died with "Unknown
  encoding".
- wasix-sysroot -29 and -30 also bring `poll` with `events` 0, WASIX epoll
  with Linux op numbers and named semaphores (no perl builtin uses them).

## 5.42.0-12: wasix-sysroot 2025.9.30-28

- Signal masks are real: `POSIX::sigprocmask` blocks and unblocks through
  slicc-kernel (≥ 1.88.0). A blocked signal stays pending (`POSIX::sigpending`)
  without running its `%SIG` handler or cutting a `select` sleep short, and the
  handler runs once when it is unblocked. Up to 5.42.0-11 the mask was
  ignored: the handler ran at once and nothing was ever pending. Kernels
  before 1.88.0 take wasix-sysroot -28's ENOSYS fallback (its README).
- `bin/perl.wasm` is mode 755 like the other command files (5.42.0-11 shipped
  it 644).

## 5.42.0-11

- `utime $atime, $mtime, $fh` (a filehandle) works: `futimes` is libc's
  `futimens`; up to 5.42.0-10 it was a stub that failed with EOPNOTSUPP
  (homescoop#307). `utime undef, undef, $fh` sets now.
- `flock` succeeds on an open handle and fails with EBADF on a closed one.
  slicc-kernel has no advisory locks, so a lock is never refused (as in
  wasix-python and wasix-ruby); up to -10 every `flock` failed with
  EOPNOTSUPP, which modules that lock their files (DB_File-style caches,
  `File::Temp` with `:flock` users) treated as fatal. `lockf` the same.
- `use filetest 'access'` makes `-r`/`-w`/`-x` ask libc's `eaccess`
  (wasix-sysroot -25); up to -10 `eaccess` was a stub, so they were false.
- `prove` and `TAP::Harness` work, and so does 4-argument `select` (and
  `IO::Select`) on more than one handle: WASI's `fd_set` is a list of fds,
  not a bit mask, and perl handed `select()` its bit strings as `fd_set`s
  (`patches/0005-sselect-wasi-fd-set.patch`). Up to -10 `prove` reported
  "No plan found in TAP output" for every test (homescoop#306) and
  `IO::Select->can_read` could trap.
- The build is reproducible: `perl -V`'s "Compiled at" is perl 5.42.0's
  release date (`SOURCE_DATE_EPOCH`), archive dates are zero, and a second
  build of the same commit is byte-identical (checked by `ladder-pr`'s
  `reproducible (wasix-perl)` job, `reproducible: true` in `recipe.yaml`).

## 5.42.0-10: wasix-sysroot 2025.9.30-27

- `utime undef, undef, $file` (and anything that touches a file through it)
  sets the times to now; up to 5.42.0-9 it set them to 0 (1970), from
  wasix-sysroot's broken `utimensat(NULL)` (homescoop#294).
- `times` reports the process CPU time slicc-kernel keeps; system and
  children's times are 0. `$^T`/`time` are unchanged.
- An empty path is ENOENT (`-e ""`, `open(my $f, "<", "")`), as on Linux.
- `getcwd` after a `chdir` through a symlink is the physical directory
  (since wasix-sysroot -18; 5.42.0-8 and older gave the logical one).
- Files have owners on slicc-kernel ≥ 1.59.0 with users on: `chown`, `-o`,
  `-O` and `stat`'s uid/gid are the kernel's, and `-r`/`-w`/`-x` ask it
  (`access`, slicc-kernel ≥ 1.63.0).

## 5.42.0-9: wasix-sysroot 2025.9.30-20

- `%SIG` handlers fire on slicc-kernel ≥ 1.47.1: the libc reports every
  disposition to the kernel (`slicc.sigaction_set`), so `$SIG{CHLD}` reaping
  and `$SIG{WINCH}` work. `alarm`, `sleep` interrupted by a signal and
  `kill $$` behave as on Linux.
- `$<`, `$>`, `$(`, `getpwuid` and `getgrgid` come from slicc-kernel's
  process credentials (slicc-kernel ≥ 1.44.0, no fallback). Root is uid 0 with
  home `/root`; a `kernel.users.add` user gets its own ids.

