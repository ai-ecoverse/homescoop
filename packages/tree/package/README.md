# `@ai-ecoverse/wasm-tree`

[tree](https://oldmanprogrammer.net/source.php?dir=projects/tree) 2.3.2 by
Steve Baker for [slicc](https://github.com/ai-ecoverse/slicc)'s wasm realm.

```bash
pnpm add -g @ai-ecoverse/wasm-tree
tree
tree -L 2 /workspace
tree -a -d -f
tree -J > tree.json
```

## 2.3.2-6: no cert kernel in the README (homescoop#847; 2026-10-20)

The README no longer names a cert kernel, which went stale whenever `cert/meta.json` moved. The cert record is the source of truth. tree itself is unchanged.

