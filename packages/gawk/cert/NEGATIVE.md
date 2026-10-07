# Negative proof (gawk)

**Date:** 2026-10-07

## Empty wasm (spec not vacuous)

`prove-negative.mjs --package gawk` → FAIL (`WebAssembly.compile(): BufferSource argument is empty`).

## Patch reverted (emscripten-no-fork-popen.patch)

Remove `packages/gawk/emscripten-no-fork-popen.patch` and run
`FORCE=1 bash scripts/host-run.sh gawk` (2026-10-07). Build succeeds, but
`cert/checklist.mjs` fails: `system("echo sys-ok")` returns status 0 without
printing `sys-ok` (fork-based `gawk_system` / non-`PIPES_SIMULATED` path does
not run the child under slicc-kernel).

```text
AssertionError: The input did not match the regular expression /sys-ok/. Input:
'status 0\n'
```

**Good tarball:** `@ai-ecoverse/wasm-gawk@5.4.1-1` — system / getline pipe /
`print | cmd` all pass.
