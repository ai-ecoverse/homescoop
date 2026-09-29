# `@ai-ecoverse/wasm-gzip`

[GNU gzip](https://www.gnu.org/software/gzip/) 1.13 for slicc's wasm realm.
`gunzip` and `zcat` are argv0 aliases (built with `-DGNU_STANDARD=0`).

```bash
ipk add -g @ai-ecoverse/wasm-gzip
gzip -c README.md > README.md.gz
gunzip -c README.md.gz
```
