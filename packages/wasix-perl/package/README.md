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
  2025.9.30-17); older kernels leave files 644 and directories 755
