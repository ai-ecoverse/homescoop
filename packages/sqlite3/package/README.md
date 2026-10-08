# `@ai-ecoverse/wasm-sqlite3`

[SQLite](https://www.sqlite.org/) 3.53.4 command-line shell (`sqlite3.c` +
`shell.c` amalgamation) linked for [slicc](https://github.com/ai-ecoverse/slicc)'s
wasm realm.

```bash
pnpm add -g @ai-ecoverse/wasm-sqlite3
sqlite3 :memory: "SELECT sqlite_version();"
```
