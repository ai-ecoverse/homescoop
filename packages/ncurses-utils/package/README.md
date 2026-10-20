# `@ai-ecoverse/wasm-ncurses-utils`

ncurses 6.5's `clear`, `tput`, `tset` and `reset` for
[slicc](https://github.com/ai-ecoverse/slicc)'s wasm realm.

```bash
pnpm add -g @ai-ecoverse/wasm-ncurses-utils
clear
tput setaf 1; echo red; tput sgr0
tput cols
reset
```

The package carries its own compiled terminfo database (`share/terminfo`:
xterm-256color, xterm, xterm-color, xterm-direct, vt100, vt102, vt220, ansi,
linux, dumb, screen, screen-256color, tmux, tmux-256color), found through
`TERMINFO` in the package's `slicc.env`. xterm-256color, xterm, vt100 and dumb
are also compiled in, as in `wasm-less` and `wasm-bash`.

Requires `@ai-ecoverse/slicc-kernel` ≥ 1.17.4.

## 6.5.0-5 (homescoop#1009; 2026-10-20)

The compiled-in terminfo search list is `/usr/share/terminfo` (after `TERMINFO`, which the package sets to its own `share/terminfo`). It used to name the build machine's work directory first, which never exists in slicc. The description is one plain sentence.
