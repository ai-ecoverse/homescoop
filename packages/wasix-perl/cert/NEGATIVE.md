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
