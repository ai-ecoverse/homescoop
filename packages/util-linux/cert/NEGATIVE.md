# Negative proof (util-linux)

**Date:** 2026-10-16, slicc-kernel 1.102.6 `--users enforce`.

- `prove-negative.mjs --package util-linux --spec users.mjs --users enforce`
  → FAIL (`WebAssembly.compile(): BufferSource argument is empty`; all six
  `bin/*.wasm` emptied).
- `@ai-ecoverse/wasm-util-linux@2.42.4-1` (no slicc credentials) passes
  users.mjs on 1.102.6 as well: the kernel refuses the opens itself. The spec
  guards the behaviour; host-run's `check-slicc-cred.mjs` guards the link.
  2.42.4-1 fails glue-by-path (0644 `bin/colrm`, `EACCES`).
