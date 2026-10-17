# Negative proof (which)

**Date:** 2026-10-08  
CI-certified (thr_b83wwqmt4e): `@ai-ecoverse/wasm-which@2.23.0-1` on slicc-kernel #88 / 1.12+; listed in `scripts/ci-certified.json`.

## Empty wasm

`prove-negative.mjs --package which` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).

## Spec non-vacuous

`cert/checklist.mjs` requires:

- `which ls` returns a `/bin` or `/usr/bin` path
- `which -a` lists two PATH providers for the same name
- missing command exits 1
- `which which` finds itself

## users.mjs (users enforce, #687)

**Date:** 2026-10-16, slicc-kernel 1.102.6 `--users enforce`.

- `prove-negative.mjs --package which --spec users.mjs --users enforce` → FAIL
  (`WebAssembly.compile(): BufferSource argument is empty`).
- `@ai-ecoverse/wasm-which@2.23.0-1` (no slicc credentials) passes users.mjs
  on 1.102.6 as well: the kernel answers the uid/gid and refuses the files
  itself, so which's own class test gets the same inputs. The spec guards the
  behaviour, not the link; host-run's `check-slicc-cred.mjs` guards the link.
  (2.23.0-1 does fail glue-by-path: 0644 `bin/which`, `EACCES`.)
