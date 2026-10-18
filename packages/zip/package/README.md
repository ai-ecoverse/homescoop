# `@ai-ecoverse/wasm-zip`

[Info-ZIP](http://infozip.sourceforge.net/) `zip` 3.0 and `unzip` 6.0 for
slicc's wasm realm.

```bash
pnpm add -g @ai-ecoverse/wasm-zip
zip out.zip file.txt
unzip -l out.zip
```

- `zip -T` runs `unzip` itself, without a shell. A `-TT` command is a shell
  command, so it needs one (`@ai-ecoverse/wasm-bash`).
- Non-ASCII names are UTF-8. `zip` sets the UTF-8 flag on them, and `unzip`
  shows them and reads Info-ZIP's Unicode path field.
- The realm's file names are UTF-8. An entry whose name isn't (an old
  Latin-1 or CP437 archive without a Unicode path) is not extracted under a
  changed name: `unzip` says `cannot create <name>` / `Illegal byte sequence`
  and exits 50. `unzip -p` still streams its bytes.
- `zip - … > file` and `zip - … | …` write valid archives, and `zip -s 0`
  merges split archives (`zip -s 1m`) back with every byte.
- `zipinfo` is unzip's zipinfo mode, the same as `unzip -Z`.
- unzip carries Debian's unzip 6.0 security patches.
