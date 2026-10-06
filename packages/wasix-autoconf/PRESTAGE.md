# wasix-autoconf PRESTAGE (2.72.0-3)

## Relocatable data dirs
- Scripts: `AC_MACRODIR` / `autom4te_perllibdir` / `trailer_m4` default to `dirname($0)/../share/autoconf`
- `M4` default → `m4` (not `/usr/bin/gm4`)
- `autom4te.cfg`: dropped hardcoded `--prepend-include '/usr/share/autoconf'`
- slicc env on every command: `AC_MACRODIR`, `autom4te_perllibdir`, `AUTOM4TE_CFG`, `M4=m4` (+ `trailer_m4` on autoconf)

## Verified
- Extracted tgz under `/tmp/.../opt/autoconf` (≠ build prefix)
- `autom4te --version` → GNU Autoconf 2.72
- Grep for build prefix in `bin/` + `share/autoconf` → none
- With automake 1.17.0-5: `autoreconf -fi` on 3-line `configure.ac` + `Makefile.am` → `configure`, `Makefile.in`, `aclocal.m4`
