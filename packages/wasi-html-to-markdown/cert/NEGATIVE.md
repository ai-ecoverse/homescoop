# Negative proof (wasi-html-to-markdown)

## 2.5.2-1

**Date:** 2026-10-25. slicc-kernel 1.167.2 (the cert kernel), users
`enforce`, against the `package.tgz` that `scripts/host-run.sh
wasi-html-to-markdown` built (sha256 `177a3034…7548`, the same from two
WORK directories). All three specs pass there and on 1.132.1 (the `engines` floor). Recorded failures:

- **Empty wasm** (`prove-negative.mjs`): `checklist.mjs` and `users.mjs`
  FAIL (`WebAssembly.compile(): BufferSource argument is empty`).
  `notices.mjs` reads only files, so it passes.
- **The 0.0.0 placeholder** (`@ai-ecoverse/wasi-html-to-markdown@0.0.0`,
  package.json and README only): all three specs FAIL. `checklist.mjs` and
  `users.mjs` get `html-to-markdown: command not found` (rc 127),
  `notices.mjs` finds no `THIRD-PARTY-NOTICES.md`.
- **Without 0001** the CLI does not build for `wasip1`:

  ```text
  # github.com/muesli/termenv
  vendor/github.com/muesli/termenv/output.go:143:17: o.foregroundColor undefined
  vendor/github.com/muesli/termenv/output.go:162:17: o.backgroundColor undefined
  vendor/github.com/muesli/termenv/termenv.go:45:16: output.ColorProfile undefined
  ```

- **termenv's js/plan9/aix fallback built for wasip1 instead of 0001**
  (what wasi-gh does): `checklist.mjs` FAIL at the first error case. That
  fallback always reports ANSI256, so an error into a pipe carries colour
  codes that native `html2markdown` doesn't write:

  ```text
  + '\x1B[41;97merror:\x1B[0m \x1B[31munknown arguments: tty.html\x1B[0m\n' +
  - 'error: unknown arguments: tty.html\n' +
  ```

## Wrong-output cases (in-spec)

Every conversion in `cert/checklist.mjs` and `cert/users.mjs` is compared
byte for byte (or by sha256 for the 3 MB page) with what a native
`html2markdown` built from the same commit writes, and `build.sh` checks
the committed goldens with that native build. A converter that differs in
any byte (another library, other defaults, a table plugin on by default, a
lost trailing newline, truncation of a large input) fails them.
