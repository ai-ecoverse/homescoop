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
