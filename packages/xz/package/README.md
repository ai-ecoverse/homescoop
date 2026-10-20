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

## 5.8.4-5: xzgrep and xzdiff (homescoop#537; 2026-10-20)

`xzgrep` and `xzdiff` are commands now. They are `#!/bin/sh` scripts, so they need `@ai-ecoverse/wasm-bash`, plus `wasm-grep` (xzgrep), `wasm-diffutils` (xzdiff), and `wasm-sed` and `wasm-coreutils` (both). Their `@xz@` placeholder is substituted now; 5.8.4-1 to -4 shipped it unset. `bin/xzless` ships, but it isn't a command: it needs a `less` that runs a `LESSOPEN` pipe, and wasm-less doesn't. Use `xz -dc FILE.xz | less` instead.

