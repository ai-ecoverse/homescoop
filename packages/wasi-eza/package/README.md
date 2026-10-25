# @ai-ecoverse/wasi-eza

[eza](https://github.com/eza-community/eza), a modern replacement for `ls`,
as a WASI preview1 command for SLICC: `eza`.

```sh
eza                 # the working directory, as a grid on a terminal
eza -l              # long view: permissions, size, owner, modified time
eza -la --icons     # with dotfiles and Nerd Font icons
eza -T -L 2 src     # a tree, two levels deep
eza -l --total-size # directories with the size of what is in them
```

`bin/eza.wasm` is eza `0.23.5` from crates.io, built by homescoop for
`wasm32-wasip1` with Rust 1.99.1 and two patches:

- **WASI.** eza's Unix code runs on WASI too: file modes, owners, groups,
  links, inodes and the fifo type come from slicc-kernel, user and group
  names from `/etc/passwd` and `/etc/group`, and the grid width from the
  terminal. `/` is the root (the command preopens it).
- **stdin.** eza 0.23 reads file names from stdin whenever stdin isn't a
  terminal, so in a script or an agent's shell `eza` listed nothing or
  waited for input. This build reads names from stdin only with `--stdin`
  (`printf 'a\nb\n' | eza --stdin`), as eza#1923 proposes and as `ls` does.

Not in this build:

- **git.** libgit2 is C, so it isn't linked: `--git` and `--git-ignore` exit
  with status 3 ("`git` feature was disabled").
- **Device numbers and block counts.** WASI has neither: devices show no
  size, and `-S`/`--blocksize` is the size rounded up to 512 bytes.
- **Time zones.** Times are UTC.
- **Extended attributes, security contexts and mount points** (`-@`, `-Z`,
  `-M`) show nothing.

Errors carry WASI's error numbers: `No such file or directory (os error 44)`,
`Permission denied (os error 2)`.

The theme file is read from `$EZA_CONFIG_DIR/theme.yml`.

Certified: the grid, long and tree views, modes, owners and groups under
slicc-kernel users, inodes and links, `--total-size`, sorting, colours on a
terminal, and listing with any stdin.

EUPL-1.2 AND MIT; see `LICENSE` and `THIRD-PARTY-NOTICES.md`.
