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
fails as expected.

## Positive path (procfs prerelease)

Against `slicc-kernel-procfs-ed6d6a1.tgz` (feat/attach-client, before #66 attach)
+ local `@ai-ecoverse/wasm-procps@4.0.5-1`:

`cert/checklist.mjs` → **ok** (`ps aux` / `pgrep` / `pkill` / `free -h` /
absolute-path `uptime`). No /proc field layout issues observed for these tools.

Note: bare `uptime` is shadowed by wasm-coreutils' empty `/usr/bin/uptime`
multi-call stub (`coreutils: unknown program 'uptime'`) — homescoop packaging,
not a kernel /proc bug.

## Empty wasm (once a good tarball is published)

`prove-negative.mjs --package procps` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).
