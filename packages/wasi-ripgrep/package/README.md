# `@ai-ecoverse/wasi-ripgrep`

[ripgrep](https://github.com/BurntSushi/ripgrep) 15 for
[slicc](https://github.com/ai-ecoverse/slicc)'s WASI preview1 realm
(`abi: "wasi"` — module only, no Emscripten glue).

```bash
pnpm add -g @ai-ecoverse/wasi-ripgrep
rg -n TODO .
```

15.2.0-3 reads piped stdin. It requires slicc-kernel ≥ 1.34.1, where a run
with no stdin gets /dev/null; on older kernels `rg pattern` without a path
searches nothing, so stay on 15.2.0-2 there (or pass a path, e.g.
`rg pattern .`).
