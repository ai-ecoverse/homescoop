# Negative proof (wasi-okf)

## 0.5.2-1

**Date:** 2026-11-19. slicc-kernel 1.191.2 (the cert kernel), its Node entry
(`createNodeKernel`, the same WASI runtime and preopens as the page),
`users: "enforce"` unless stated, with `@ai-ecoverse/wasm-bash@5.3.0-23` and
`@ai-ecoverse/wasm-coreutils@9.12.0-15` installed as in `cert/meta.json`.
The package is new, so there is no published predecessor. The negatives are
the nearest builds and setups the specs guard against. The control, the
ladder-pr tarball of this PR (`package.tgz` sha256 `d1b1a9cb…`,
`bin/okf.wasm` sha256 `4e1ad5a4…`), passes `cert/checklist.mjs` and
`cert/users.mjs` in the same runner, and in the browser cert on CI.

- **Built without `build.ldflags`** (the same recipe through
  `scripts/build-wasip1-go-command.sh` as it was before this PR, which
  passes only `-s -w -buildid=`; `bin/okf.wasm` sha256 `e573db3b…`):
  `cert/checklist.mjs` → FAIL at its first case. `okf version` exits 0 but
  prints upstream's default:

  ```text
  { "commit": "none", "date": "unknown", "name": "okf", "version": "dev" }
  ```

  `scripts/test/build-wasip1-go-command.test.mjs` is the committed negative
  for the script itself: on the script before this PR, the two expansion
  tests fail (`-X main.version=0.5.2` never reaches `go build`), and a
  variant that appends the field without expanding `{{version}}` fails too.
- **`"preopenRoot": true` removed** from the okf command (the CI tarball,
  package.json edited): `cert/checklist.mjs` → FAIL at the missing-path case,
  rc 2 as expected but with Go's EBADF instead of ENOENT (slicc-kernel#1868):

  ```text
  load bundle /nonexistent: stat bundle root: stat /nonexistent: Bad file number
  ```

- **`users: "off"`** (how a cert without users enforce would run it):
  `cert/users.mjs` → FAIL. bob's `okf index /home/alice/open` exits 0 and
  writes `/home/alice/open/index.md` and `datasets/index.md` into alice's
  0755 bundle.
- **Empty wasm** (what `prove-negative.mjs` does to `bin/okf.wasm`):
  `cert/checklist.mjs` and `cert/users.mjs` → FAIL, 2 of 2
  (`WebAssembly.compile(): BufferSource argument is empty`).

## Wrong-output cases (in-spec)

The checklist asserts the JSON okf prints, not just exit codes: the version,
the files `init` creates, validate's valid/errors/warnings (true, 0, 4 on
upstream's `testdata/valid`), the three concept ids, the `show` body, the
`search --tag ga4` hits, the two backlinks, 3 graph edges and 4 index files.
It also checks exit 1 with `okf/frontmatter/type-required` for a concept
without a type, exit 4 for an unknown command and exit 2 with ENOENT for a
missing path. Each value was also checked against the real `okf.wasm`
under wasmtime.
