# `@ai-ecoverse/wasm-util-linux`

The text tools from [util-linux](https://github.com/util-linux/util-linux)
2.42.4 for [slicc](https://github.com/ai-ecoverse/slicc)'s wasm realm:
`rev`, `column`, `hexdump`, `colrm`, `look` and `getopt`.

```bash
pnpm add -g @ai-ecoverse/wasm-util-linux
printf 'abc\n' | rev
column -t -s, data.csv
hexdump -C file.bin
eval set -- "$(getopt -o ab: --long alpha,beta: -- "$@")"
```

`mount` and `umount` are in `@ai-ecoverse/wasm-mount`, not here. `col` is
not included.

Certified on `@ai-ecoverse/slicc-kernel` 1.23.0.
