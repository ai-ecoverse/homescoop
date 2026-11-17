# @ai-ecoverse/wasm-graphviz

[Graphviz](https://graphviz.org)'s `dot` for the slicc wasm realm, built by
[homescoop](https://github.com/ai-ecoverse/homescoop/tree/main/packages/graphviz).

```sh
echo 'digraph { a -> b }' | dot -Tsvg
dot -Kneato -Tjson graph.dot
```

The layouts (`dot`, `neato`, `fdp`, `circo`, `twopi`, `osage`, `patchwork`, by `-K`)
and the core renderers (`svg`, `json`, `json0`, `xdot`, `dot`, `plain`, `fig`, `ps`, …) are
linked in. Not built: HTML-like labels (no expat), `svgz` (no zlib), the bitmap
renderers (no cairo, gd or pango), and `sfdp`, which needs GTS's triangulation.
