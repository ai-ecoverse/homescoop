# `@ai-ecoverse/wasi-impeccable`

[Impeccable](https://impeccable.style) engine **0.1.12** for
[slicc](https://github.com/ai-ecoverse/slicc)'s WASI preview1 realm
(`abi: "wasi"` — module only, no Emscripten glue).

**This package is the detector only.** It runs file and directory scans:

```bash
pnpm add -g @ai-ecoverse/wasi-impeccable
impeccable detect path/to/page.html
impeccable detect src/
impeccable --version   # prints the engine version (e.g. 0.1.12)
```

It does **not** include URL or Chrome/CDP scans, live mode, or the skill
installer (`install` / `link` / `update`). For those, use upstream
[`impeccable`](https://www.npmjs.com/package/impeccable) /
[pbakaus/impeccable](https://github.com/pbakaus/impeccable).
