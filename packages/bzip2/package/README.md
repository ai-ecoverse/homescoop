# `@ai-ecoverse/wasm-bzip2`

[bzip2](https://sourceware.org/bzip2/) 1.0.8 for slicc: `bzip2` / `bunzip2` /
`bzcat` / `bzip2recover`, plus static `libbz2.a`. Also ships `bzgrep` / `bzdiff`
shell scripts (need `wasm-bash` + grep/diff).

```bash
pnpm add -g @ai-ecoverse/wasm-bzip2
bzip2 -k file.txt
bunzip2 -k file.txt.bz2
```

Since 1.0.8-2 `bzip2recover` works: it splits a damaged file into
`rec00001<name>.bz2`, … (`bzip2recover-llu.patch`: musl's printf rejects
upstream's `%Lu`, which made 1.0.8-1 stop with "I/O error … Invalid
argument" before writing anything). This build also uses slicc-kernel's
process credentials.

