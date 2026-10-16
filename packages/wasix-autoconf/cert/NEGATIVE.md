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

## 2.72.0-9: licence texts (homescoop#565, 2026-10-16)

`cert/licence.mjs` against the published 2.72.0-8: FAIL, `package/LICENSE has no GPLv3 text, which 40 files name`. Its LICENSE was upstream's `COPYING` (GPLv2) alone, because `build.sh` passed `COPYING` and `COPYINGv3` to `homescoop_stage_license`, which copies only the first file that exists. The GPLv3 text and the Autoconf Configure Script Exception were missing, although package.json declares GPL-3.0-or-later. 2.72.0-9's LICENSE holds all three texts.
