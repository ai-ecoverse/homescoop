# `@ai-ecoverse/wasix-automake`

GNU Automake scripts for slicc: `automake` and `aclocal` (and their `-1.17`
names). Needs wasix-perl, wasix-autoconf and wasix-m4.

With its dependencies alone (plus a shell and coreutils), `aclocal`,
`autoconf` and `automake --add-missing` write `configure`, `aclocal.m4` and
`Makefile.in`. From 1.17.0-9 the pinned wasix-autoconf (2.72.0-7 and later) runs
`autom4te` without grep; before, `aclocal` failed without grep with
`autom4te: error: need GNU m4 1.4 or later: m4`.

## Running `configure`

The generated `configure` and its Makefiles need a POSIX userland, as on any
system: `sh` (wasm-bash), coreutils, **grep, sed and awk**, and `make` to
build. slicc's base set has most of them; elsewhere:

```bash
pnpm add -g @ai-ecoverse/wasm-grep @ai-ecoverse/wasm-sed @ai-ecoverse/wasm-gawk @ai-ecoverse/wasm-gmake
```
