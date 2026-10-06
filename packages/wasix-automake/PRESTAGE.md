# wasix-automake PRESTAGE (1.17.0-5)

## Relocatable data dirs
- `aclocal`: `@automake_includes` ← `$ACLOCAL_AUTOMAKE_DIR` or `dirname($0)/../share/aclocal-1.17`
- `aclocal`: `@system_includes` ← `dirname($0)/../share/aclocal` (not `/usr/share/aclocal`)
- `Automake::Config` `$libdir` ← `$AUTOMAKE_LIBDIR` or dirname of `__FILE__`
- `AUTOCONF` / `AUTOM4TE` defaults → bare `autoconf` / `autom4te` (no build-prefix PATH bake-in)
- slicc env on every command: `AUTOMAKE_LIBDIR`, `ACLOCAL_AUTOMAKE_DIR`, `ACLOCAL_PATH`

## Verified
- Extracted tgz under `/tmp/.../opt/automake` (≠ build prefix)
- `aclocal --print-ac-dir` → `$pkg/share/aclocal` (with and without env)
- Grep for build prefix → none
- With autoconf 2.72.0-3: `autoreconf -fi` smoke OK
