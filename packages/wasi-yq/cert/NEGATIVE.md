# Negative proof (wasi-yq)

## 4.54.1-1

**Date:** 2026-10-26. slicc-kernel 1.167.3 (the cert kernel), users
`enforce`, against the `package.tgz` that `scripts/host-run.sh wasi-yq`
built (sha256 `13980157…24bf1`, the same from two WORK directories). All
three specs pass there and on 1.132.1 (the `engines` floor). Recorded
failures:

- **Empty wasm** (`prove-negative.mjs`): `checklist.mjs` and `users.mjs`
  FAIL (`WebAssembly.compile(): BufferSource argument is empty`).
  `notices.mjs` reads only files, so it passes.
- **The 0.0.0 placeholder** (`@ai-ecoverse/wasi-yq@0.0.0`, package.json
  and README only): all three specs FAIL. `checklist.mjs` and `users.mjs`
  get `yq: command not found` (rc 127) for every case, `notices.mjs` and
  the tarball-notices check find no `THIRD-PARTY-NOTICES.md`.

## Wrong-output cases (in-spec)

Every case in `cert/checklist.mjs` is compared byte for byte (the 4 MB
cases by sha256 and size) with what a native `yq` built from the same
commit writes: stdout, stderr, the exit status, and for `-i` the edited
file and the temp files left behind. `build.sh` checks the committed
goldens with that native build. A yq that differs in any byte (another
implementation such as just-bash's JavaScript `yq`, other defaults, lost
comments, a different error text or exit status, truncation of a large
file) fails it. The one allowed difference is Go wasip1's errno text
(`No such file or directory`, `Permission denied`), listed in
`test/wasip1.mjs`.

## 4.54.2-1: version from recipe.yaml (homescoop#2061; 2026-11-13)

Renovate bumped mikefarah/yq to 4.54.2 (#2061). The refresh left the
4.54.1 commit pin; host-build failed closed on the tag check. This
release pins tag `v4.54.2` (`a433067`), refreshes goldens (failed `-i`
cleans its temp since 4.54.2; bad-YAML stderr from go-yaml), and updates
notices for the modules Go 1.27.3's `go list -deps` links (still
`go-textseg/v17`; utfbom, go-json, go.yaml.in/yaml/v4, x/net and x/text
bump).

- **No version in the spec:** `checklist.mjs` reads yq's version from
  recipe.yaml (`cert/lib/version.mjs`) for `yq --version`, so a Renovate
  bump needs no cert edit for that row (as rsync did in homescoop#2028
  and cmake in #1981). `scripts/test/wasi-yq-cert-version.test.mjs`
  fails on 4.54.1-1's `checklist.mjs`, which pins
  `version v4.54.1`. In the same test a wrong expected version (4.54.1,
  4.54.20, 4.54.2.0, 5.54.2) fails the check.
- **NEGATIVE:** the published 4.54.1-1 fails the new row at
  `yq --version names yq version v4.54.2, recipe.yaml's version: yq
  (https://github.com/mikefarah/yq/) version v4.54.1\n` (slicc-kernel
  1.167.3, users enforce). It also fails `notices.mjs` (intro line and
  the bumped module headings) and the goldens for `bad expression in
  place` (`left` 1→0) and `bad yaml` stderr.
