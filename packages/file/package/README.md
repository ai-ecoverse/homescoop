# `@ai-ecoverse/wasm-file`

[file](https://www.darwinsys.com/file/) 5.46 for slicc, with compiled
`magic.mgc` and zlib/bzip2/xz decompression (`-z`). Default `MAGIC` points at
the package’s `share/misc/magic.mgc`.

```bash
pnpm add -g @ai-ecoverse/wasm-file
file README.md
file -i -z archive.tar.xz
```
