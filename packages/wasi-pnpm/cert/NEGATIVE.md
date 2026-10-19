# Negative proof (wasi-pnpm cert/, homescoop#478, #522)

**Date:** 2026-10-16. `cert/install.mjs` ran on slicc-kernel 1.94.0 with users enforce (macOS arm64 builds, `--soft`). On 12.9.1-9 every case passes, in 43 s.

## 12.9.1-8 (no 0002): build paths in pnpm.wasm (#522)

On the published 12.9.1-8, every behaviour case passes, and the build-path check fails:

```text
install.mjs:121    pnpm.wasm contains a build path ("/home/runner")
install.mjs:121#3  pnpm.wasm contains a build path ("homescoop-work/pnpm-")
```

It carries pnpm-cli's `CARGO_MANIFEST_DIR`, `/home/runner/work/_temp/homescoop-work/pnpm-5dafb098…/pnpm/crates/cli`. It also carries 7 `/home/runner/.cargo/registry/…/tree-sitter-0.26.9/…` paths, the `__FILE__` of tree-sitter's C asserts. 12.9.1-9 has neither: 0002 removes the first, and `TARGET_CFLAGS=-ffile-prefix-map=…` remaps the second. A local build has 561 `/cargo/registry/…` paths and no host path, and `build.sh`'s new strings check refuses any that comes back.

## Without 0001 (parking_lot_core's `nightly` feature)

A build of the same tree without 0001 links the panicking wasm parker. The cert fails at the 0001 check:

```text
install.mjs:122  pnpm.wasm links parking_lot_core's panicking wasm parker (0001 missing)
```

The installs alone don't catch it. In this harness, the spec's three 30-package installs never made a lock park, and neither did a stress run of three 200-package installs with 8 files each and 0–40 ms of registry latency per response. All of them passed without 0001. So 0001's runtime trap (the original reason for the patch) stays covered by the string check and by build.sh.

That build also showed that build.sh's old parker check, `strings … | grep -q …` under `set -o pipefail`, never fired. grep's early exit kills `strings` with SIGPIPE, and the pipeline then reads as "no match". The build without 0001 passed the check (`old-guard-MISSED`). The check now greps to `/dev/null` and catches it.

## Empty wasm (spec not vacuous)

`prove-negative.mjs --package wasi-pnpm` fails at the first `pnpm --version`.

## 12.9.1-10: function names for a trap (2026-10-18)

The published 12.9.1-9 against 12.9.1-10's `install.mjs` (slicc-kernel 1.94.0, users enforce, `--soft`): **FAIL, 10 of 52 assertions.** There is no `bin/pnpm.wasm.names`, and pnpm.wasm has a `name` section of generated names only (`f4998` for function 5000: build.mjs's wasm2wat `--generate-names --no-debug-names` / wat2wasm `--debug-names` round trip). Under `SLICC_WASM_BACKTRACE=1`, SLICC then names no frame: the kernel reads a sidecar only for a module without a name section. That is why bios's `pnpm: wasm trap in thread 4: memory access out of bounds` named nothing.

A local 12.9.1-10-style build (same tree; macOS, so not byte-identical to CI's) passes. names.py found 32445 function names, plus the 2 imports, and checked that the exports `_start`, `malloc`, `free`, `wasi_thread_start` and `__wasm_init_tls` carry their own names at their instrumented indices.

## 12.9.1-11: no half-there packages during an update (homescoop#1128, 2026-10-18)

The published 12.9.1-10 against 12.9.1-11's `cert/update-readers.mjs` (slicc-kernel 1.124.2, users enforce, `--soft`, slicc-heavy): **FAIL.** The observations:
- `big 240 1.0.0` 665 times, `big 260 2.0.0` 7 times and `big torn` once (a sample that raced the rename, allowed);
- **`big` half there 30 times, with 0 to 234 files in lib/ and package.json still present:** upstream's stage_and_swap deletes the old tree file by file before the new one is renamed in;
- `fresh absent` 470 times and `fresh 200 1.0.0` 73 times;
- **`fresh` half there 160 times, with 0 to 200 files and no package.json:** a new package is populated in place.

A sample reads package.json, lists lib/, then reads package.json again. If the two reads disagree or the directory has gone, it counts as `torn` (the reader raced a rename). Otherwise a wrong file count, or a missing package.json, counts as half there. The spec also measures the kernel's own directory rename first: 10 plain `mv`s of a 240-file directory under the same poller. slicc-kernel moves a directory in one step where the browser can (FileSystemHandle.move), and otherwise copies it, which a reader can see half done. That window is the kernel's, and pnpm may add none: a package may be seen half there at most `ceil(mvHalf/10 × 3) + 2` times. The `+ 2` is for the kernel's directory rename, #1212 (slicc-kernel#1122): Chrome 156 OPFS has no directory `move()`, so the kernel copies the tree file by file, and a sample can land mid-copy even when the baseline caught none. CI's mv baseline was 0 of 240, yet 12.9.1-11 showed one sample of `big` with 174 of 260 files and no package.json. Locally the baseline was 0 of 296 samples. 12.9.1-10 fails with big half there 37 times and fresh 167.

12.9.1-11's patches/0004 renames the old tree aside, renames the staged one in and only then deletes the old one, and it stages a new package before renaming it into place. The pnpm deps-restorer crate's own unit tests pass with the patch (633 of 633, host `cargo test -p pnpm-deps-restorer --lib`). Upstream's RemoveExisting test (a failing remove_dir_all before the swap) is replaced by one checking that an unremovable old tree no longer fails the swap.

## 12.9.1-12: the process umask and fewer mode calls (2026-10-19)

The published 12.9.1-11 against 12.9.1-12's `cert/modes.mjs` (slicc-kernel 1.124.2, users enforce, `--soft`): **FAIL, 3 assertions.** Under `umask 077`, `node_modules/tool/bin/tool`, `lib/a.js` and `package.json` came out 755, 644 and 644. The host's `pnpm_fs.umask` answered 022 whatever the process had. pnpm computes a copied file's mode from that answer, and its post-copy `fchmod` then widened what the kernel had created under 077.

The same tarball with only 12.9.1-12's `host/pnpm-host.mjs` (the umask read from the kernel, `proc-umask`, once per process) gives 711/600/600 and passes. The 711 is pnpm's bin linking adding `+x`. patches/0005 (the lookups the KC's trace counted: the shard mode once per directory, no per-file `fstat`/`fchmod` once the kernel is seen to apply creation modes) must give the same modes, which the -12 build is certified on.

## 12.9.1-13: 0004 dropped (homescoop#1127's loop, 2026-10-19)

Not a negative proof but the reason for this release. pnpm-agent-loop run 39181721981 ran 12.9.1-11 on slicc-kernel 1.124.2: bios's agent lockfile, 8 shards of 40 rounds each, under users enforce. **41 of the 160 rounds that reported failed**, every one with `failed to rename staging directory "…/node_modules/openai_pacquet-stage_…" to "…/node_modules/openai": Operation timed out (os error 73)`. There were no wasm traps. On this kernel and Chrome 156 OPFS, a directory rename is a file-by-file copy (slicc-kernel#1122, partly addressed in 1.126.1), and for openai's tree the synchronous call ran out of time. 12.9.1-10 had no rename there. So 12.9.1-13 drops 0004, keeps 12.9.1-12's umask and mode-call fixes, and moves update-readers.mjs to stress/. homescoop#1128 is open again for a design that needs no directory rename.

## 12.9.1-14: kernel copies and 256 MiB of initial memory (homescoop#1127, 2026-10-19)

- **#1127:** pnpm-agent-loop run 39204855613 ran 12.9.1-13 on kernel 1.124.2 (CI Linux Chromium, users enforce) and got **11 traps in 240 rounds**: `pnpm: wasm trap in thread 3..6: memory access out of bounds`. All were warm-store rounds, on rayon workers in `pnpm_tarball::prefetch::prefetch_cas_paths_blocking`, and each was the first write into a fresh allocation. 12.9.1-13 imports 68 pages (4.3 MiB) of memory and grows it constantly there; 12.9.1-14 imports 4096 pages. The kernel lane is checking the browser side (`--no-sandbox` on Linux, and V8's trap handler). The loop on 12.9.1-14 is the comparison.
- **0006:** there's no behaviour to refuse; this is a speed change. On cert kernel 1.128.0 every install spec copies through `ctx.fs.copyFile`, and modes.mjs and large-package.mjs must hold as on 12.9.1-13. `test/pnpm-host.test.mjs` checks ENOSYS, EEXIST, EXDEV and EINVAL.

## 12.9.1-15: the project directory and the pin (patches/0007, 0008; thr_r75dacjwyi, 2026-10-19)

The published 12.9.1-13 against `cert/project-dir.mjs` (slicc-kernel 1.128.0, users enforce, as root with a `/node_modules`, `--soft`): **FAIL, 6 of 9 assertions.**
- `pnpm add tiny` in `/tmp/empty`, which has no package.json, exits 1 with `ERR_PNPM_PACKAGE_MANIFEST_IO_ERROR … No such file or directory (os error 44)`, and `/tmp/empty/package.json` has no `tiny`. pnpm walked up to `/`, whose `node_modules` is a project marker.
- `pnpm init`, with a registry whose latest pnpm is 99.0.0, pins `packageManager: pnpm@99.0.0` and `devEngines.packageManager: {version: 99.0.0, onFail: download}`. The next `pnpm add tiny` fails with **`ERR_PNPM_UNSUPPORTED_RUNTIME` × This WebContainer runtime cannot install or switch to pnpm v99.0.0**, the live seven's error (there it was 12.14.0).

A local build of 12.9.1-15 (macOS, the same patches) passes all 9. pnpm resolves its own pin, the running 12.9.1, from the default registry whatever `--registry` says, so the spec's stub answers registry.npmjs.org's `/pnpm` too (12.9.1 and 99.0.0). 0007 pins the running pnpm on wasm, and 0008 stops the prefix walk below `/` unless pnpm runs in `/`.
