# SciPy for WASIX — scope (before build)

**Context:** `@ai-ecoverse/wasix-python@3.14.2-6` is `latest`. Next queue item: **scipy**, prioritizing `scipy.stats`, `scipy.optimize`, `scipy.interpolate`, `scipy.signal`.

**Do not start a full build until this plan is accepted.**

## Verdict

| Approach | Feasible? | Recommendation |
|---|---|---|
| **Pyodide-style f2c + OpenBLAS (C)** | Yes — proven on wasm32 | **Preferred.** Port their pipeline to wasixcc/ehpic PIC side modules. |
| **flang-wasm / LLVM Fortran** | No for v1 | wasix LLVM has no flang; Fortran→wasm still immature for SciPy’s F77/F90 mix. |
| **Ship a hard subset only** | Poor fit | Those four modules still pull `linalg` / `special` / often `sparse`. A “stats-only” wheel is a different product and breaks normal `import scipy.*`. Prefer full SciPy (minus tests), same as Pyodide. |

## What we have today

- `@ai-ecoverse/py-numpy` is **`allow-noblas`** (no OpenBLAS/LAPACK). SciPy needs BLAS/LAPACK before a real build.
- wasixcc = clang/wasm-ld + `sysroot-ehpic` PIC; **no Fortran frontend** in `~/.wasixcc/llvm`.
- Homescoop rules unchanged: wasix SOABI, no renames, `.pyc`, unresolved = 0 on staged set, top-level ctypes grep, SLICC import check by you.

## How Pyodide does it (template)

From current `pyodide/packages/scipy/meta.yaml` (SciPy **1.18.0**):

1. **OpenBLAS** as a shared wasm lib (`NOFORTRAN=1`, C kernels; historically `TARGET=RISCV64_GENERIC`).
2. **Host `gfortran` + hoodmane/f2c** so Meson/f2py think they have Fortran; sources are translated to C then compiled with the wasm C toolchain.
3. **ABI patches** (5 named patches + a large in-script `sed` pass): Fortran wrappers must return `int` not `void` so wasm import/export types match OpenBLAS exactly (`UNDERSCORE_G77`, etc.).
4. **Extra:** boost (headers), meson pin (`< 1.10` for a `pow_di` link issue), unvendor tests for the ship wheel.

Published Pyodide scipy **1.18** wasm wheel ≈ **13.3 MB** (file); OpenBLAS shared lib ≈ **6 MB**. Unpacked SciPy on disk is larger; with our `.pyc` policy expect a homescoop package in the **~40–80 MB unpacked / ~15–30 MB npm tarball** ballpark (numpy today ≈ 36 MB unpacked).

## Size estimates (homescoop)

| Artifact | Est. unpacked | Est. npm tarball | Notes |
|---|---|---|---|
| `py-openblas` (new) | 6–10 MB | 3–5 MB | C-only OpenBLAS, PIC `.so` or static `.a` vendored into scipy |
| `py-scipy` (full, no tests) | 40–80 MB | 15–30 MB | Aligns with Pyodide wheel + our pyc/stdlib layout |
| “Subset” stats+opt+interp+signal only | still ~30–60 MB | — | Still needs BLAS + large `special`/`linalg` objects; little win |

A **real** size cut only comes later (SciPy’s Fortran-free / BLIS / semicolon-lapack direction, still incomplete for 1.18).

## Proposed plan (phased)

### Phase A — OpenBLAS for WASIX (blocker for SciPy)
1. New recipe `@ai-ecoverse/py-openblas` (or `wasm-openblas`) built with wasixcc, `NOFORTRAN=1`, single-thread first, PIC for ehpic.
2. Stage + SLICC smoke: `cblas_ddot` / `dgemm` via a tiny C test or numpy linked against it (optional numpy rebuild later).
3. Size gate: report staged size before publishing.

### Phase B — SciPy cross build (f2c path)
1. Target **SciPy 1.18.x** (matches Pyodide; CPython 3.14).
2. Host tools: `gfortran` (for Meson detection) + build **hoodmane/f2c**; compile translated C with wasixcc `MODULE_KIND=shared-library` like numpy.
3. Port Pyodide’s 5 patches + the int-return `sed` script; adapt paths for wasix (no emscripten `-fwasm-exceptions` → wasix EH / our ehpic flags).
4. Meson cross file: `system=wasi`, `cpu_family=wasm32`, BLAS/LAPACK → OpenBLAS from Phase A.
5. Ship **full** `scipy` (drop tests), SOABI `cpython-314-wasm32-wasix`.
6. Hard checks: unresolved=0, ctypes grep, `.pyc`, PRESTAGE SOABI.

### Phase C — Acceptance (your SLICC)
```python
import scipy, scipy.stats, scipy.optimize, scipy.interpolate, scipy.signal
# plus a small numerical smoke per module
```

### Explicitly out of scope for v1
- flang-based Fortran
- Multi-threaded OpenBLAS (can revisit; WASIX has threads, Pyodide started without)
- scipy.odr / heavy sparse.linalg edge cases if they block (drop or stub only if forced)
- Rebuilding numpy onto OpenBLAS in the same PR (nice follow-up for speed)

## Risks

- **Signature hell:** wasm requires exact types; most of Pyodide’s work is here. Budget calendar time for link/import mismatches, not just compile.
- **PIC / dylink:** OpenBLAS + many scipy `.so`s under ehpic; same `--allow-undefined` / export discipline as numpy.
- **Meson + f2c integration** with wasixcc may need a small wrapper script (Pyodide’s `_f2c_fixes` equivalent).
- **Boost** (Pyodide host dep) — confirm whether 1.18 still needs it for our enabled modules.

## Decision needed from you

1. **Proceed with Phase A (OpenBLAS) then full SciPy 1.18 via f2c?** (recommended)
2. Or insist on a **subset package** knowing size savings are small and imports diverge from stock SciPy?

No build starts until you pick (1) or (2).
