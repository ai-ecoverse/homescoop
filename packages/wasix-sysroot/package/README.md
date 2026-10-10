# @ai-ecoverse/wasix-sysroot

WASIX libc/libcxx/compiler-rt sysroots, laid out as a wasixcc `SYSROOT_PREFIX`:

- `sysroot` — no wasm exceptions (asyncify path)
- `sysroot-eh` / `sysroot-ehpic` — legacy EH, static / PIC
- `sysroot-exnref-eh` / `sysroot-exnref-ehpic` — exnref EH, static / PIC

Each tree has a real `lib/wasm32-wasip1` (not a symlink — npm/ipk skip
links). clang 24 `--target=wasm32-wasip1` resolves crt/libc there.
`unistd.h` declares `fork` under `__wasix__` even with `-fwasm-exceptions`.
EH `libc.a` archives get real `fork`/`_Fork` from asyncify (static trees).
Every libc embeds SLICC identity stubs (getuid=1000) and reports
`st_uid`/`st_gid` 1000 from `stat`/`lstat`/`fstat`/`fstatat`.
`chmod`/`fchmod`/`fchmodat`/`umask` and the modes of fresh `open(O_CREAT)` /
`mkdir` go to the kernel's `slicc_fs` imports, and `stat`/`fstat`/`lstat`
read the permission bits back from them (slicc-kernel ≥
1.35.1); on a kernel without them they stay the upstream no-ops. EH trees ship
libc++/libc++abi/libunwind rebuilt from LLVM b158b0ae6 (same as wasm-clang)
with exnref flags.

Data only — no commands. Set `WASIXCC_SYSROOT_PREFIX` to this package directory.
