# Negative proof (wasi-eza)

## 0.23.5-1

**Date:** 2026-10-25. slicc-kernel 1.167.1 (the cert kernel), users
`enforce`, against the `package.tgz` that `scripts/host-run.sh wasi-eza`
built. All three specs pass there, and on 1.132.1 (the `engines` floor) and
1.167.2 (`latest`). Recorded failures:

- **Empty wasm** (`prove-negative.mjs`): `checklist.mjs` and `users.mjs`
  FAIL (`WebAssembly.compile(): BufferSource argument is empty`).
  `notices.mjs` reads only files, so it passes.
- **Without 0001** eza 0.23.5 does not build for `wasm32-wasip1`
  (`--no-default-features`): `could not compile eza (lib) due to 18
  previous errors`, among them `non-exhaustive patterns:
  Column::Permissions not covered`, `cannot find value stdout_term_width`
  and no `changed_time`, `size`, `type_char`, `is_empty_dir` or
  `security_context` for `File`: eza only has Unix and Windows code.
- **0001 without `start()`** (the call in `main()` commented out):
  `checklist.mjs` FAIL at `eza -1 /`, which lists the working directory:

  ```text
  AssertionError [ERR_ASSERTION]: / has dev: rc=0
  a.txt
  broken -> nowhere
  link -> a.txt
  pipe
  run.sh
  shared
  sub
  ```

  The kernel preopens `/` and then `./` (the working directory), and
  wasi-libc takes the last preopen with an empty prefix for `/`.
- **Without 0002** (0001 only): `checklist.mjs` FAIL at the first case.
  With no stdin (the kernel's `/dev/null`) eza reads it, gets no names and
  lists nothing:

  ```text
  AssertionError [ERR_ASSERTION]: no stdin: rc=0
  + ''
  - 'a.txt\nbroken -> nowhere\nlink -> a.txt\npipe\nrun.sh\nshared\nsub\n'
  ```

- **`users.mjs` with users `off`**: FAIL. Every file belongs to the caller
  (`root root`), which is what the kernel reports without owners.

## Wrong-output cases (in-spec)

`cert/checklist.mjs` compares whole listings: the long view's type
characters and modes (0600, 0755, 1777 with `t`, a fifo's `|`, links with
their targets), octal modes and numeric ids, sizes, the tree, `--total-size`,
`-d` on `/`, `/tmp` and relative paths, and the pty grid at 30 and 200
columns. A build that read WASI's filestat alone (no mode bits: every file
0644 or 0755 by type, no fifo), took `/` for the working directory, or
ignored the terminal's width fails them. `cert/users.mjs` compares owners
and groups by name and number and the "you" style, so names from the wrong
table, the caller for every file, or a stat that skips the kernel's
permission checks fail it.

## 0.23.5-2: the working directory, not a stale PWD (2026-11-09)

- **The defect:** 0001's `start()` took `PWD` as it was. A parent that sets a child's working directory without rewriting `PWD` (Node's `spawnSync` with `{ cwd }`, on real Node too) made eza list the parent's directory, and relative names failed (`"inner": No such file or directory`). When `PWD` named no directory, the chdir failed, `start()` left the `./` preopen open, and `eza /` listed the working directory again.
- **The fix:** `start()` changes into `PWD` only when it is absolute, not `/`, has no `..` and is `.`'s device and inode; otherwise into the path found by walking `..` up to the root, as getcwd(3) does. A Rust probe (wasm32-wasip1 and wasip1-threads, with and without `preopenRoot`, slicc-kernel 1.134.3 and 1.176.2) shows `current_dir()` is `/` in every case, `stat(".")` is the real directory, and before the chdir `stat("/")` is `.`'s too, so `PWD=/` would pass a device and inode check alone.
- **Negative:** the published 0.23.5-1 fails `cert/cwd.mjs` at `PWD=/tmp` (`eza -1` printed `ezacwd-only-in-tmp.txt`; `browser-cert --spec cwd.mjs`, slicc-kernel 1.176.2, users enforce). Run to the end, 12 of its 38 assertions fail: `PWD=/tmp` and `PWD=/` list the wrong directory and the relative names are not found; `/nonexistent`, `sub` and the cwd spelt with `..` list the cwd for `eza /`; cwd `/` with `PWD` naming sub lists sub. 0.23.5-2 passes all 38, and the whole cert.

## 0.23.5-3: node's spawnSync with { cwd } in cert/cwd.mjs (2026-11-11)

- **What:** `cert/cwd.mjs` adds the biome-shaped row: node (slicc-jsh 0.64.0) started in `/tmp` runs `spawnSync('eza', …, { cwd })` with `PWD=/tmp` inherited, the same through `sh -c`, and with PWD removed; relative names and `eza /` under that spawn; plus the direct `PWD=/tmp`, `/nonexistent` and `/` cases already in 0.23.5-2. The README names 0.23.5-1 and earlier as taking a stale `PWD`.
- **Negative:** the published 0.23.5-1 fails the new first case, node's `spawnSync` with `{ cwd }` and `PWD=/tmp` inherited (`eza -1` printed `ezacwd-only-in-tmp.txt`; `browser-cert --spec cwd.mjs`). PWD removed and `sh -c` pass on 0.23.5-1 too, since the kernel and the shell reset `PWD`. 0.23.5-2 already has the code fix; 0.23.5-3 is the cert and README close of homescoop#2013.
