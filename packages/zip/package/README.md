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
- `zip - … > file` and `zip - … | …` write valid archives, and `zip -s 0`
  merges split archives (`zip -s 1m`) back with every byte.
