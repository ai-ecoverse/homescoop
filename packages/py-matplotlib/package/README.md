# @ai-ecoverse/py-matplotlib

Matplotlib 3.11.2 for slicc WASIX CPython 3.14 (`cp314-wasix_wasm32`).

- Default backend: **Agg**
- Built with `system-freetype`, `macosx=false`
- FreeType symbols left unresolved for `@ai-ecoverse/wasm-freetype`

## Since 3.11.2-9

Takes `@ai-ecoverse/wasix-python` as a range, the CPython 3.14.2 line from
packaging revision 16 up, and depends on the py-* that take it the same way
(homescoop#702). With a newer
python, npm installs one python, not a second one under each py-*, and
`_slicc_site.discover()` finds every py-* without PYTHONPATH. The matplotlib
bytes are 3.11.2-7's; only `package.json` and this README change.

## Since 3.11.2-8

Depends on `@ai-ecoverse/py-kiwisolver` 1.5.1-7, so `layout="constrained"`
(and `constrained_layout=True`) works. Through 3.11.2-7 the pinned
py-kiwisolver 1.5.1-6 ended python with `wasm trap: function signature
mismatch` as soon as the constrained layout engine ran (homescoop#197). The
matplotlib bytes are 3.11.2-7's; only `package.json` changes.
