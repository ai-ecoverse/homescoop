# Negative proof (mount)

**Date:** 2026-10-08
New package, so it needs human cert first and is not in `scripts/ci-certified.json`.

## Empty wasm

`prove-negative.mjs --package mount` → FAIL. The cert fails at the first `mount`.

## Kernel without process mounts

On `@ai-ecoverse/slicc-kernel@1.16.0` (before #92), `run.mjs --package mount` fails at the first step:

```
mount -t tmpfs: rc=32 stderr=mount: /mnt/t: mount(2) is not available (needs a slicc-kernel with process mounts).
```

This shows that the shim's ENOSYS fallback works inside the real kernel, and that the checklist can't pass without #92.

## Spec non-vacuous

`cert/checklist.mjs` asserts the exact listing lines (including `nomedium` for fsa), an empty listing of the nomedium root, "No medium found" below it (`cat`/`ls /mnt/f/x`), that the unmounted file is gone, EROFS under `-o ro`, and an error plus rc ≠ 0 for each of: bad fstype, bad option value, `/proc` target, non-mount umount, and hostfs without a hook.
