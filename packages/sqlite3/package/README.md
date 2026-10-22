# `@ai-ecoverse/wasm-sqlite3`

[SQLite](https://www.sqlite.org/) 3.54.0 command-line shell (`sqlite3.c` +
`shell.c` amalgamation) linked for [slicc](https://github.com/ai-ecoverse/slicc)'s
wasm realm.

```bash
pnpm add -g @ai-ecoverse/wasm-sqlite3
sqlite3 :memory: "SELECT sqlite_version();"
```

Built without WAL (`SQLITE_OMIT_WAL`): there is no shared memory in the
wasm realm. `PRAGMA journal_mode=WAL` keeps the rollback journal and
answers `delete`, so databases that ask for WAL keep working. Up to
3.54.0-1 the switch went through and the file then failed to open
(`disk I/O error`).

A WAL-format database made on a host (any file a host app or host
`sqlite3` switched to WAL) can't be opened here, read-write or
`-readonly`: it fails with `file is not a database (26)`, which is not
corruption. Switch it back on the host before copying it in:

```bash
sqlite3 file.db 'pragma journal_mode=delete'
```

## Several processes and tabs on one database

SQLite's file locks work between processes: two `sqlite3` processes, or
`sqlite3` and wasix-python's `sqlite3` module, on one database exclude each
other. A writer that finds the database locked gets `database is locked`
(rc 1 in the shell, unless you set `.timeout`), and the holder's commit
keeps its rows. That needs slicc-kernel 1.100.0 or later (homescoop#513;
wasix-python 3.14.2-22 or later on the Python side).

Across browser tabs, the locks exclude since slicc-kernel 1.119.0
(slicc-kernel#944), what's written under them is coherent in the other tab
since 1.120.1 (slicc-kernel#949), and opens no longer fail with `unable to
open database file` since 1.122.3 (slicc-kernel#950). So two tabs on one
database are safe on slicc-kernel 1.122.3 or later.

On older kernels, use one process per database at a time: concurrent
writers can lose committed updates (slicc-kernel#665), and two tabs can
lose or corrupt what the other wrote.

## The prompt

The interactive prompt is SQLite 3.54's new one (`SQLite-3.54 memory-> `,
naming the open database). Set `SQLITE_PS1='sqlite> '` for the old prompt.
