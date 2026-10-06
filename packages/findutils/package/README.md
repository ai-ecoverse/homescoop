# `@ai-ecoverse/wasm-findutils`

[GNU findutils](https://www.gnu.org/software/findutils/) 4.10.0 for slicc's
wasm realm: `find` and `xargs` only (no `locate` / `updatedb`).

`-exec` / `-execdir` / `-ok` and `xargs` (including `-P`) go through slicc's
fork + `slicc_spawn` path.

```bash
ipk add -g @ai-ecoverse/wasm-findutils
find . -name '*.c' -type f
find . -print0 | xargs -0 echo
```
