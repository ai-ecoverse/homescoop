# `@ai-ecoverse/wasm-gawk`

GNU awk for slicc.

```bash
pnpm add -g @ai-ecoverse/wasm-gawk
```

## Not built: extensions and -M (homescoop#681)

gawk is configured with `--disable-extensions --disable-mpfr`, so none of the bundled extensions load:

- `gawk -i inplace …` fails with ``gawk: fatal: cannot open source file `inplace' for reading`` (rc 2), and the file is left alone. Instead, use `gawk '…' f > f.new && mv f.new f`, or `sed -i`.
- `-l filefuncs`, `@load "ordchr"` and the other extensions (`readdir`, `time`, `fork`, …) fail with ``cannot open shared library``.
- `-M` prints `gawk: warning: -M ignored: MPFR/GMP support not compiled in` and computes in double precision.

`cert/extensions.mjs` pins these messages and the workaround.

