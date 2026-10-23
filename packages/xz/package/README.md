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

`xzless` is a command now. It runs `less` with a `LESSOPEN` pipe through `xz`, which works from `@ai-ecoverse/wasm-less` 668.0.0-7. The packages the scripts need are dependencies now (peer dependencies since 5.8.4-8, below), so installing wasm-xz pulls them in: `wasm-bash`, `wasm-coreutils` (`mktemp`, `expr`, `rm`), `wasm-grep` (xzgrep), `wasm-sed`, `wasm-diffutils` (xzdiff) and `wasm-less` (xzless). `xzmore` isn't shipped: it needs a `more`, and there is none. Use `xzless` instead.

## 5.8.4-8: peer dependencies (slicc-bios#939; 2026-10-23)

The packages the scripts call are `peerDependencies` now, each `"*"`, instead of exact `dependencies`. 5.8.4-7 pinned `wasm-coreutils` 9.12.0-13, so next to a top-level 9.12.0-15 npm nested a second, older coreutils under wasm-xz. Now there's one copy of each, the top-level one. npm 7+ and pnpm still install the peers when they're missing, so installing wasm-xz on its own still gives `xzgrep`, `xzdiff` and `xzless` everything they need. The peers aren't optional: without them the scripts fail with `command not found`.

The range is `"*"` because homescoop versions look like prereleases (`X.Y.Z-N`). npm matches a prerelease only against a range bound with the same `X.Y.Z`: `>=9.12.0-13` accepts 9.12.0-15 but rejects the next upstream's 9.13.0-1, and `npm install` then fails with `ERESOLVE`. npm accepts any version for `"*"`. The scripts just need the commands on `PATH`, and any wasm-bash, wasm-coreutils, wasm-grep, wasm-sed or wasm-diffutils has them. The one floor the range can't express: `xzless` needs `@ai-ecoverse/wasm-less` 668.0.0-7 or later, the first version that runs its `LESSOPEN` pipe. With an older wasm-less, `less` asks whether to show the `.xz` file as binary. The cert runs with the current versions: wasm-bash 5.3.0-23, wasm-coreutils 9.12.0-15, wasm-grep 3.12.0-8, wasm-sed 4.10.0-6, wasm-diffutils 3.12.0-4 and wasm-less 668.0.0-7.
