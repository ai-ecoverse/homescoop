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

## 2.72.0-11: pin bump, no NEGATIVE (homescoop#864, 2026-10-21)

2.72.0-11 changes only the pins: wasix-m4 1.4.20-4 → 1.4.20-7 (homescoop#1557's rebuild on sysroot -40) and wasix-perl 5.42.0-18 → 5.42.0-21, plus a plain description. Autoconf's scripts and data are the same build as 2.72.0-10, and no behaviour changes, so there is no new negative: `cert/checklist.mjs` and `cert/licence.mjs` run unchanged against the new peers (cert/meta.json needsInstall, with wasix-automake 1.17.0-13). The cert kernel moves from slicc-kernel 1.100.4 to 1.132.1, because wasix-perl 5.42.0-21 declares engines.slicc-kernel >=1.120.0 (wasix-perl's own cert runs on 1.132.1).

## 2.72.0-12: pin bump, no NEGATIVE (homescoop#864, 2026-10-22)

2.72.0-12 changes only the wasix-perl pin: 5.42.0-21 → 5.42.0-22 (homescoop#1632's rebuild on wasix-sysroot -42, a sized heap). wasix-m4 stays at 1.4.20-7. Autoconf's scripts and data are the same build as 2.72.0-10, and no behaviour changes, so there is no new negative: `cert/checklist.mjs` and `cert/licence.mjs` run unchanged against the new peers (cert/meta.json needsInstall, with wasix-automake 1.17.0-14). The cert kernel stays at slicc-kernel 1.132.1: wasix-perl 5.42.0-22 still declares engines.slicc-kernel >=1.120.0, and its own cert runs on 1.132.1.
