# `@ai-ecoverse/wasm-less`

[less](https://www.greenwoodsoftware.com/less/) 668 linked for
[SLICC](https://github.com/ai-ecoverse/slicc)'s wasm realm, with static widec
ncurses 6.5 and compiled-in terminfo fallbacks (`xterm-256color`, `xterm`,
`vt100`, `dumb`). No `/usr/share/terminfo` on the VFS.

```bash
pnpm add -g @ai-ecoverse/wasm-less
less README.md
```

## Input preprocessors

`LESSOPEN` and `LESSCLOSE` work from 668.0.0-7 (homescoop#1484), both the `|cmd %s` pipe form and the form that prints a replacement file name. The commands run through `$SHELL -c` (or `/bin/sh -c`), so they need `@ai-ecoverse/wasm-bash` and whatever tools they call, e.g. `@ai-ecoverse/wasm-xz` for `LESSOPEN='|xz -dc %s'`.

This less is still a secure build (`--with-secure`): `!` shell commands, `|` pipes, `v` (editor), `:e`, `s` (log file), opening OSC 8 links (`^O^O` or a second mouse click; no `LESS_OSC8_*` handler runs), tags, lesskey files and the history file are refused with "Command not available". Only `LESSOPEN` and `LESSCLOSE` are allowed, through `secure-lessopen.patch`.
