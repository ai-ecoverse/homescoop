# Negative proof (wasix-automake)

## 1.17.0-8: pins wasix-autoconf 2.72.0-6 (homescoop#470, 2026-10-16)

`cert/checklist.mjs` against the published 1.17.0-8 (slicc-kernel 1.100.4, users enforce): FAIL at its first assertion, `the tarball pins wasix-autoconf 2.72.0-6, the cert runs 2.72.0-7`.

With 2.72.0-6 in the realm (what a user's install of 1.17.0-8 gets), the bare-PATH `aclocal` fails:

```text
sh: line 1: grep: command not found
autom4te: error: need GNU m4 1.4 or later: m4
aclocal: error: autom4te failed with exit status: 1
```

1.17.0-9 is 1.17.0-8's bytes with the pin moved to 2.72.0-7, whose autom4te matches `m4 --help` in Perl, and a new README. It passes.

## 1.17.0-12: bin/automake names the build host's shell (homescoop#909)

`cert/paths.mjs` against the published 1.17.0-12 (built on ubuntu-latest; slicc-kernel 1.102.6, users enforce, 2026-10-17) fails:

```text
browser-cert: FAIL packages/wasix-automake/cert/paths.mjs
AssertionError [ERR_ASSERTION]: bin/automake names /bin/sh, not the build host's shell
```

Its line 41 is `$ENV{'SHELL'} = '/bin/bash' if exists $ENV{'DJDIR'};`. A macOS host-run of 1.17.0-13 (configure with `CONFIG_SHELL=/bin/sh SHELL=/bin/sh`) writes `'/bin/sh'` and passes.

## 1.17.0-14: pin bump, no NEGATIVE (homescoop#864, 2026-10-21)

1.17.0-14 changes only the pins: wasix-autoconf 2.72.0-10 → 2.72.0-11 (homescoop#1565) and wasix-perl 5.42.0-18 → 5.42.0-21, together, so an install still has one perl, plus a plain description. Automake's scripts and data are the same build as 1.17.0-13, and no behaviour changes, so there is no new negative: `cert/checklist.mjs` and `cert/paths.mjs` run unchanged against the new peers (cert/meta.json needsInstall, with wasix-m4 1.4.20-7). The cert kernel moves from slicc-kernel 1.100.4 to 1.132.1, because wasix-perl 5.42.0-21 declares engines.slicc-kernel >=1.120.0.

## 1.17.0-15: pin bump, no NEGATIVE (homescoop#1676)

1.17.0-15 changes only the pins: wasix-autoconf 2.72.0-11 → 2.72.0-12 (homescoop#1676) and wasix-perl 5.42.0-21 → 5.42.0-22, together, because autoconf 2.72.0-12 pins perl 5.42.0-22 and the one-perl check needs the same perl on both sides. Automake's scripts and data are the same build as 1.17.0-14, and no behaviour changes, so there is no new negative: `cert/checklist.mjs` and `cert/paths.mjs` run unchanged against the new peers (cert/meta.json needsInstall, with wasix-m4 1.4.20-7). Against these peers the published 1.17.0-14 fails the checklist's first assertion (`the tarball pins wasix-autoconf 2.72.0-11, the cert runs 2.72.0-12`), and its wasix-perl 5.42.0-21 pin would also fail the one-perl check beside autoconf 2.72.0-12's 5.42.0-22. The cert kernel stays slicc-kernel 1.132.1, which meets wasix-perl 5.42.0-22's engines.slicc-kernel >=1.120.0.
