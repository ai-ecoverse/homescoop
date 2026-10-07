# Negative proof (procps)

**Date:** 2026-10-07  
New package — not in `ci-certified.json` until thr_b83wwqmt4e human-certifies
after slicc-kernel /proc ships.

## Stock kernel (no /proc) — recorded

Against `@ai-ecoverse/slicc-kernel@^1.8.10` and a locally built
`@ai-ecoverse/wasm-procps@4.0.5-1` tarball:

```text
browser-cert: FAIL packages/procps/cert/checklist.mjs
AssertionError: ps aux stderr=Error, do this: mount -t proc proc /proc
47 !== 0
```

That proves the checklist is not vacuous: without Linux-shaped `/proc`, `ps`
fails as expected. Re-run against a #66-era kernel prerelease (coordinate with
thr_ej75dimgf5) for the positive path.

## Empty wasm (once a good tarball is published)

`prove-negative.mjs --package procps` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).
