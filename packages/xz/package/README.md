# `@ai-ecoverse/wasm-xz`

[XZ Utils](https://tukaani.org/xz/) 5.8.4 for slicc: `xz` / `unxz` / `xzcat` /
`lzma` / `unlzma` / `lzcat`, static `liblzma`, and `xzgrep` / `xzdiff` / `xzless`
scripts.

```bash
pnpm add -g @ai-ecoverse/wasm-xz
xz -k file.txt
xzcat file.txt.xz
```

## Licence

`0BSD AND GPL-2.0-or-later`. liblzma, its headers and `xz` are 0BSD. The
`xzgrep`, `xzdiff` and `xzless` scripts are adapted from GNU gzip and are
GPL-2.0-or-later. `LICENSE` holds upstream's `COPYING` summary, then the
texts of both licences (`COPYING.0BSD`, `COPYING.GPLv2`).
