# `@ai-ecoverse/wasix-autoconf`

GNU Autoconf as slicc script commands: `autoconf`, `autoheader`, `autom4te`,
`autoreconf`, `autoscan`, `autoupdate`, `ifnames`. Its dependencies,
`@ai-ecoverse/wasix-perl` and `@ai-ecoverse/wasix-m4`, are all `autoconf`
itself needs. With `@ai-ecoverse/wasix-automake`, `aclocal`, `autoconf` and
`automake --add-missing` run with those alone (plus a shell and coreutils).

## Running `configure`

The `configure` script Autoconf writes is a shell script that needs a POSIX
userland, as on any system: `sh` (wasm-bash), coreutils, and **grep, sed
and awk**. They are not dependencies of this package; slicc's base set has
them, and elsewhere:

```bash
pnpm add -g @ai-ecoverse/wasm-grep @ai-ecoverse/wasm-sed @ai-ecoverse/wasm-gawk
```

Without them `configure` fails with `sed: command not found` (and the like).
A build then also wants `make` (`@ai-ecoverse/wasm-gmake`).

Before 2.72.0-7, `autom4te` (and `aclocal`, `autoreconf`, `automake` through
it) needed grep too, and without it failed with a misleading
`autom4te: error: need GNU m4 1.4 or later: m4`.
