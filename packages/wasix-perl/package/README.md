# @ai-ecoverse/wasix-perl

Perl 5.42 for slicc WASIX (`perl`, `prove`, `pod2man`, `cpan`, `perldoc`).

- Cross-built with [perl-cross](https://github.com/arsv/perl-cross) + wasixcc against wasix-sysroot
- Core XS (POSIX, Fcntl, Cwd, Digest::*, Encode, Socket, …) statically linked
- `fork` / `system` / backticks via WASIX `proc_fork` (asyncify)
- `PERL5LIB` defaults to package `lib/perl5` plus `~/.local/share/perl5`
- `use re 'debug'` / `'eval'` and XS `Cwd` (`getcwd`, `abs_path`) work since
  5.42.0-7: the static perl has no DynaLoader, and these modules only load their
  XS when `DynaLoader::boot_DynaLoader` exists (-7 provides a no-op one and ships
  `DynaLoader.pm`). In -6, `perl -Mre=debug` died ("Undefined subroutine
  &re::install") and `getcwd` inside a mount returned an empty string.
- File modes on slicc-kernel ≥ 1.35.1: `umask`, `chmod`, `mkdir` modes and
  File::Temp's 600/700 hold, and `stat` reports them (wasix-sysroot
  slicc_fs, since -17); older kernels leave files 644 and directories 755

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

