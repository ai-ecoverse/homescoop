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

Use one process per database at a time: with the current slicc-kernel,
concurrent writers from different processes can lose committed updates
(slicc-kernel#665).

The interactive prompt is SQLite 3.54's new one (`SQLite-3.54 memory-> `,
naming the open database). Set `SQLITE_PS1='sqlite> '` for the old prompt.
