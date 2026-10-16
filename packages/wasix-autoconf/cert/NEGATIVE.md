# Negative proof (wasix-autoconf)

## 2.72.0-6: autom4te needs grep (homescoop#470, 2026-10-16)

`cert/checklist.mjs` against the published 2.72.0-6 (slicc-kernel 1.100.4, users enforce): FAIL at its third assertion.

```text
autom4te --version without grep: rc=1
--- stderr
sh: line 1: grep: command not found
autom4te: error: need GNU m4 1.4 or later: m4
```

autom4te's probe for GNU m4 ran `m4 --help </dev/null 2>&1 | grep reload-state` through the shell, so without grep in the realm autom4te, and aclocal (`aclocal: error: autom4te failed with exit status: 1`), autoconf and autoreconf through it, refused the wasix-m4 they had. 2.72.0-7's build.sh matches `m4 --help` in Perl.

The same spec passes on the 2.72.0-7 build (`host-run.sh wasix-autoconf`).
