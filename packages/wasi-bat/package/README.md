# `@ai-ecoverse/wasi-bat`

[bat](https://github.com/sharkdp/bat), "a cat(1) clone with wings", for
[slicc](https://github.com/ai-ecoverse/slicc)'s WASI preview1 realm
(`abi: "wasi"`, a module with no Emscripten glue): syntax highlighting for
the 183 languages bat bundles, line numbers, headers and grids, with
bat's themes.

```bash
pnpm add -g @ai-ecoverse/wasi-bat
bat src/main.rs              # highlighted, with a header and line numbers on a terminal
bat -p -l json < data.json   # plain style, language by name
bat -r 10:20 -H 15 file.py   # a line range, one line highlighted
cmd | bat                    # piped output is printed as is, as by cat
```

`bin/bat.wasm` is bat 0.26.1 from its crates.io release, built by homescoop
for `wasm32-wasip1` with Rust 1.99.1 and upstream's default features except
Git. Regular expressions run on Oniguruma, as in upstream's release builds,
and bat's own syntax regression tests (196 files) give the same bytes as
upstream's expected output.

Differences from bat on Linux:

- **No pager.** WASI programs can't start other programs, so bat writes to
  stdout whatever `--paging`, `--pager`, `BAT_PAGER` or `PAGER` say;
  `--pager=builtin` too. Pipe into `less` for paging: `bat --color=always
  file | less -R`.
- **No Git markers.** bat is built without its `git` feature (libgit2), so
  the gutter shows no added, changed or removed lines, and `--diff` is not
  an option.
- **Error numbers.** I/O errors carry WASI's numbers: "No such file or
  directory (os error 44)", "Permission denied (os error 2)".

The terminal width comes from slicc-kernel's `slicc_tty.winsize`, so bat's
grid and wrapping fit the terminal. Kernels before 1.48.0 don't have it;
bat runs there too, at 80 columns (or `--terminal-width`). The config file, custom themes and
syntaxes (`bat cache --build`) live under `$HOME`, as on Linux:
`~/.config/bat` and `~/.cache/bat`. Without `$HOME`, the home directory
is the user's `/etc/passwd` entry (from `$USER`), as on Linux.

Certified on slicc-kernel 1.167.1 with users enforced: highlighting, styles,
line ranges, stdin, errors, the "IO circle" check (`bat f >> f` is refused),
paging falling back to stdout, the config file, `bat cache --build`, the
terminal width on a pty, and file permissions between users.

MIT OR Apache-2.0; see `LICENSE`, `NOTICE` and `THIRD-PARTY-NOTICES.md`
(every crate, Oniguruma, Rust's standard library, wasi-libc, and the licences
of bat's bundled syntaxes and themes, as `bat --acknowledgements` prints them).
