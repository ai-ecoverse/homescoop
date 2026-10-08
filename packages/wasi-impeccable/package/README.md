# `@ai-ecoverse/wasi-impeccable`

[Impeccable](https://impeccable.style) engine **0.1.12** for
[slicc](https://github.com/ai-ecoverse/slicc)'s WASI preview1 realm
(`abi: "wasi"` — module only, no Emscripten glue).

Ships the **detect-focused** CLI: scan HTML/CSS/JS files for design
anti-patterns. Live mode, Chrome URL scans, and skill install verbs are not
in this build (they need sockets / a browser host).

```bash
pnpm add -g @ai-ecoverse/wasi-impeccable
impeccable detect path/to/page.html
impeccable --version
```
