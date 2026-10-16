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
