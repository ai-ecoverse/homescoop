# `@ai-ecoverse/wasm-gzip`

[GNU gzip](https://www.gnu.org/software/gzip/) 1.15 for slicc's wasm realm.
`gunzip` and `zcat` are argv0 aliases (built with `-DGNU_STANDARD=0`).

```bash
pnpm add -g @ai-ecoverse/wasm-gzip
gzip -c README.md > README.md.gz
gunzip -c README.md.gz
```

Since 1.15.0-2 gzip uses slicc-kernel's process credentials (restoring an
owner as root works, any other user keeps its own) and ends by the signal it
sends itself (`kill -TERM` of its own pid, slicc-kernel ≥ 1.73.2). The output
of `gzip -k`/`gunzip` keeps the input's times on slicc-kernel ≥ 1.73.3 (#441:
earlier kernels reset an mtime set on an open file when gzip then changed its
owner, in the browser).

