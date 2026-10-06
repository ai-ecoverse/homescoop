# `@ai-ecoverse/wasm-bzip2`

[bzip2](https://sourceware.org/bzip2/) 1.0.8 for slicc: `bzip2` / `bunzip2` /
`bzcat` / `bzip2recover`, plus static `libbz2.a`. Also ships `bzgrep` / `bzdiff`
shell scripts (need `wasm-bash` + grep/diff).

```bash
ipk add -g @ai-ecoverse/wasm-bzip2
bzip2 -k file.txt
bunzip2 -k file.txt.bz2
```
