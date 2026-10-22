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

`xzgrep` and `xzdiff` are commands now. They are `#!/bin/sh` scripts, so they need `@ai-ecoverse/wasm-bash`, plus `wasm-grep` (xzgrep), `wasm-diffutils` (xzdiff), and `wasm-sed` and `wasm-coreutils` (both). Their `@xz@` placeholder is substituted now; 5.8.4-1 to -4 shipped it unset. `bin/xzless` shipped but wasn't a command until 5.8.4-7 (below).


## 5.8.4-7: dependencies and xzless (homescoop#1487; 2026-10-21)

`xzless` is a command now. It runs `less` with a `LESSOPEN` pipe through `xz`, which works from `@ai-ecoverse/wasm-less` 668.0.0-7. The packages the scripts need are dependencies now, so installing wasm-xz pulls them in: `wasm-bash`, `wasm-coreutils` (`mktemp`, `expr`, `rm`), `wasm-grep` (xzgrep), `wasm-sed`, `wasm-diffutils` (xzdiff) and `wasm-less` (xzless). `xzmore` isn't shipped: it needs a `more`, and there is none. Use `xzless` instead.
