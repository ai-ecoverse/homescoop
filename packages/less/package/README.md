# `@ai-ecoverse/wasm-less`

[less](https://www.greenwoodsoftware.com/less/) 668 linked for
[SLICC](https://github.com/ai-ecoverse/slicc)'s wasm realm, with static widec
ncurses 6.5 and compiled-in terminfo fallbacks (`xterm-256color`, `xterm`,
`vt100`, `dumb`). No `/usr/share/terminfo` on the VFS.

```bash
pnpm add -g @ai-ecoverse/wasm-less
less README.md
```
