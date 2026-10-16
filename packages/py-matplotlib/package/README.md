# @ai-ecoverse/py-matplotlib

Matplotlib 3.11.2 for slicc WASIX CPython 3.14 (`cp314-wasix_wasm32`).

- Default backend: **Agg**
- Built with `system-freetype`, `macosx=false`
- FreeType symbols left unresolved for `@ai-ecoverse/wasm-freetype`

## Since 3.11.2-8

Depends on `@ai-ecoverse/py-kiwisolver` 1.5.1-7, so `layout="constrained"`
(and `constrained_layout=True`) works. Through 3.11.2-7 the pinned
py-kiwisolver 1.5.1-6 ended python with `wasm trap: function signature
mismatch` as soon as the constrained layout engine ran (homescoop#197). The
matplotlib bytes are 3.11.2-7's; only `package.json` changes.
