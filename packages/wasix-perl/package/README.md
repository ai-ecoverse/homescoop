# @ai-ecoverse/wasix-perl

Perl 5.42 for slicc WASIX (`perl`, `prove`, `pod2man`, `cpan`, `perldoc`).

- Cross-built with [perl-cross](https://github.com/arsv/perl-cross) + wasixcc against wasix-sysroot
- Core XS (POSIX, Fcntl, Cwd, Digest::*, Encode, Socket, …) statically linked
- `fork` / `system` / backticks via WASIX `proc_fork` (asyncify)
- `PERL5LIB` defaults to package `lib/perl5` plus `~/.local/share/perl5`
- File modes on slicc-kernel ≥ 1.35.1: `umask`, `chmod`, `mkdir` modes and
  File::Temp's 600/700 hold, and `stat` reports them (wasix-sysroot
  2025.9.30-17); older kernels leave files 644 and directories 755
