# `@ai-ecoverse/wasm-binutils`

`strings`, `size` and `readelf` from [GNU binutils](https://www.gnu.org/software/binutils/)
2.47 for [slicc](https://github.com/ai-ecoverse/slicc)'s wasm realm.

```bash
pnpm add -g @ai-ecoverse/wasm-binutils
strings -n 8 app.wasm
strings -t x -e S file.bin
size prog.o
readelf -h prog.o
```

Point `strings` at a real file: the command names under `/usr/bin` are
empty stubs in slicc, not the binaries.

BFD knows x86-64/i386 and aarch64 ELF and wasm. `nm`, `ar`, `ranlib` and
`strip` come with `@ai-ecoverse/wasm-clang`.

Certified on `@ai-ecoverse/slicc-kernel` 1.23.0.
