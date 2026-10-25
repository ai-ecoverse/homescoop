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
