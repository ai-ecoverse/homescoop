# Negative proof (procps)

**Date:** 2026-10-07  
CI-certified (thr_b83wwqmt4e): `@ai-ecoverse/wasm-procps@4.0.5-1` on slicc-kernel 1.9.0; listed in `scripts/ci-certified.json`.
Browser-cert pin now `@ai-ecoverse/slicc-kernel@1.14.0` (pnpm global command roots). Real per-process VmSize/VmRSS + meminfo used since 1.12.0 (thr_ej75dimgf5 #77/#80); USER/whoami fixed in 1.11.0.


## Users: 4.0.5-2 (H1, homescoop#207)

`cert/users.mjs` on the published 4.0.5-2, slicc-kernel 1.44.0 Node entry. procps linked no `--wrap`, so `getpwuid` was Emscripten's stub, which never finds a name:
- as root, `ps -o user=,comm=` exits 1 and prints nothing;
- as `cone`, USER is `1000`.

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

## 4.0.7-4: the inherited-ignore and flock shims (homescoop#973, #947; 2026-10-17)

4.0.7-4 links the updated `shims/slicc` (#960). A `constructor(101)` in `slicc_signals.c` seeds `SIG_IGN` for each signal the kernel's `sliccKernel.sigInherited()` reports; on a kernel without the hook it changes nothing. A strong `flock()` in `slicc_libc_gaps.c` goes through the `env.__syscall_flock` import, which answers 0 without the kernel half (slicc-kernel#967 and #968). The built wasm now imports `env.slicc_sig_inherited_js`, and `env.__syscall_flock` where the program calls `flock`. The published 4.0.7-3 imports neither, so on a hooked kernel it can't see an inherited ignore, and its `flock` never conflicts. The program code is unchanged, and the specs pass on 4.0.7-3 as well. The build also gets #908's prefix maps and DWARF strip.

`cert/k122/flock.mjs` is an extra-kernel row on slicc-kernel 1.122.0, the first release whose `__syscall_flock` wrapper (slicc-kernel#968) answers the shim. It needs `@ai-ecoverse/wasix-perl` 5.42.0-19, whose flock is libc's `slicc.flock`. The published 4.0.7-3 fails it there:

```text
AssertionError: pgrep's flock(LOCK_SH|LOCK_NB) was granted while perl 1003 held LOCK_EX: the shim's flock does not reach the kernel
```

4.0.7-4 passes. pgrep's second open is refused with EWOULDBLOCK, so `pgrep -L -F` prints the holder's pid. After the holder exits, `pgrep -L -F` fails with "Locking check for pidfile failed".

## 4.0.7-5: shim drift (homescoop#1491; 2026-10-20)

4.0.7-5 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 4.0.7-4 in `THIRD-PARTY-NOTICES.md`, `bin/free`, `bin/kill`, `bin/pgrep`, `bin/pidof` and more, so this is a packaging bump. The package's own code is unchanged. `THIRD-PARTY-NOTICES.md` also gains the slicc-shims section that every wasm linking the shims now carries (homescoop#1388). The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.

## 4.0.7-6: COPYING.LIB for libproc2 (homescoop#1878; 2026-10-25)

**The defect:** build.sh passed `COPYING`, `COPYING.LIB` and `LICENSE` to `homescoop_stage_license`, which copies only the first candidate that exists to `package/LICENSE`. So every release through 4.0.7-5 shipped procps-ng's `COPYING` (GPL-2.0) and no `COPYING.LIB`, the GNU Library General Public License text upstream ships for libproc2 (`library/`, whose sources say LGPL-2.1-or-later). Every command links libproc2 statically.

**The fix:** build.sh stages `COPYING` alone with `homescoop_stage_licenses` (which fails when the file is missing, where `homescoop_stage_license` would keep the committed `package/LICENSE`), copies `COPYING.LIB` into the package (`files[]` lists it), and prints `procps-licences: PASS …` only when `LICENSE` is the GPL v2 text, `COPYING.LIB` is the GNU Library General Public License v2 text, and `library/readproc.c` still says LGPL 2.1 or later. Otherwise it stops with `procps-licences: FAIL`. The package licence is now `GPL-2.0-or-later AND LGPL-2.1-or-later` (recipe and package.json), and README.md says which licence covers what.

**cert/licence.mjs against the published @ai-ecoverse/wasm-procps@4.0.7-5** (`run.mjs --package procps --tarball ai-ecoverse-wasm-procps-4.0.7-5.tgz --spec licence.mjs --kernel @ai-ecoverse/slicc-kernel@1.132.1 --users enforce`): `cert-run: FAIL procps fail`, at `package.json files[] lists COPYING.LIB: ["README.md","LICENSE","THIRD-PARTY-NOTICES.md","bin"]`. `licenceFileErrors` on the unpacked 4.0.7-5 gives `COPYING.LIB is not in the package` and three `README.md lacks` phrases (`COPYING.LIB`, `libproc2`, `GNU Lesser General Public License, version 2.1 or later`). The 4.0.7-6 package directory gives none.

**Reproducible (homescoop#1852):** procps is off `scripts/reproducible-pending.json`. `scripts/test/reproducible-optin.test.mjs` now checks that procps is off the list and that classify rebuilds it. On main's list it fails with `procps is still in scripts/reproducible-pending.json`.
