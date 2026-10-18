# Negative proof (xz)

## 5.8.4: patch absorbed upstream (2026-10-09)

xz 5.8.4's `src/common/mythread.h` uses `sigprocmask()` for single-threaded
builds when `!defined(__wasm__) || defined(__EMSCRIPTEN__)`, which is what
`wasm-mythread-sigmask.patch` added, so the patch is gone and no longer
listed in `cert/meta.json`. The `-T0` / `-T2` 4 MiB cases in
`cert/roundtrip.mjs` stay as the regression check for that path; the
empty-wasm proof below still holds. The patch-reverted proof below is the
5.8.1 record.

**Date:** 2026-10-07

## Empty wasm (spec not vacuous)

`node scripts/browser-cert/prove-negative.mjs --package xz --tarball <good.tgz>`  
→ FAIL: `WebAssembly.compile(): BufferSource argument is empty`.

## Patch reverted (exercises wasm-mythread-sigmask.patch)

On homescoop `main` at xz 5.8.1, remove `packages/xz/wasm-mythread-sigmask.patch` and run `bash scripts/host-run.sh xz`.

**Result:** compile fails in `src/xz/signals.c`:

```text
signals.c:146:4: error: call to undeclared function 'mythread_sigmask'
```

Without the patch, `__wasm__` keeps `mythread_sigmask` out of `mythread.h`, so the
CLI cannot build. The threaded/large cases in `cert/roundtrip.mjs` (`xz -T0` /
`-T2` over 4 MiB) are the runtime path that needs that symbol once linked.

**Good tarball:** `@ai-ecoverse/wasm-xz@5.8.1-1` — `cert/roundtrip.mjs` passes
(including `-T0`/`-T2` 4 MiB).

## 5.8.4-2: licence texts (homescoop#511, 2026-10-16)

`cert/licence.mjs` against the published 5.8.4-1: FAIL. Its 18 `SPDX-License-Identifier` lines are 0BSD ×15 and GPL-2.0-or-later ×3 (`bin/xzgrep`, `bin/xzdiff`, `bin/xzless`), but package.json says `"license": "0BSD"`: `GPL-2.0-or-later (package/bin/xzdiff, package/bin/xzgrep, package/bin/xzless) is not in package.json's license "0BSD"`. Its `package/LICENSE` is upstream's `COPYING` summary alone, without either licence's text. `build.sh` passed `COPYING`, `LICENSE` and `COPYING.0BSD` to `homescoop_stage_license`, which copies only the first file that exists.

## 5.8.4-4: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs xz` (host-run's #908 check) fails on the published 5.8.4-3: 2 file(s) ship 1,424,239 bytes of DWARF.

The published 5.8.4-3 also has 76 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/xz.wasm, lib/liblzma.a (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

5.8.4-4 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 5.8.4-3 too; the negative is the #908 check.
