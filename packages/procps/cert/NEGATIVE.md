# Negative proof (procps)

**Date:** 2026-10-07  
CI-certified (thr_b83wwqmt4e): `@ai-ecoverse/wasm-procps@4.0.5-1` on slicc-kernel 1.9.0; listed in `scripts/ci-certified.json`.
Browser-cert pin now `@ai-ecoverse/slicc-kernel@1.12.0` (thr_ej75dimgf5 #77/#80): real per-process VmSize/VmRSS + meminfo used; USER/whoami fixed in 1.11.0.

## Stock kernel (no /proc) — recorded

Against `@ai-ecoverse/slicc-kernel@^1.8.10` and a locally built
`@ai-ecoverse/wasm-procps@4.0.5-1` tarball:

```text
browser-cert: FAIL packages/procps/cert/checklist.mjs
AssertionError: ps aux stderr=Error, do this: mount -t proc proc /proc
47 !== 0
```

That proves the checklist is not vacuous: without Linux-shaped `/proc`, `ps`
fails as expected.

## Positive path (slicc-kernel 1.9.0)

Against `@ai-ecoverse/slicc-kernel@1.9.0` + local `@ai-ecoverse/wasm-procps@4.0.5-1`
+ packaging-only `@ai-ecoverse/wasm-coreutils@9.12.0-2`:

`cert/checklist.mjs` → **ok** (`ps` / `pgrep` / `env kill -TERM` / `pkill` /
`free -h` / `uptime`). Attached-worker `ps` is human cert on 1.9.0.

Earlier prerelease proof: `slicc-kernel-procfs-ed6d6a1.tgz`.

## Kernel cosmetics (closed — thr_ej75dimgf5)

Human cert on 1.9.0 noted two non-blocking quirks; both fixed upstream:

| Symptom (1.9.0) | Fix |
| --- | --- |
| `ps` USER column showed `1000` (no `/etc/passwd` for uid 1000) | 1.11.0 — USER / `whoami` → `web_user` by default |
| `free -h` showed fixed MemTotal and 0B used | 1.12.0 (#77 / PR #80) — per-process wasm size in `/proc/<pid>/stat|statm|status`; meminfo used = sum over processes |

No wasm-procps republish required.

## Empty wasm (once a good tarball is published)

`prove-negative.mjs --package procps` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).
