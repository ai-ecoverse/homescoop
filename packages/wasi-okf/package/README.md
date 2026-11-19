# `@ai-ecoverse/wasi-okf`

[okf](https://github.com/okfcli/okf) 0.5.2, the Open Knowledge Format CLI,
built for WASI preview1 so it runs in slicc-kernel. An OKF bundle is a
folder of Markdown files with YAML front matter; okf creates, validates,
lints, indexes, searches and graphs one, and prints JSON on stdout.

```bash
pnpm add -g @ai-ecoverse/wasi-okf
okf init ~/kb
okf validate ~/kb
okf search ~/kb --tag analytics
```

Exit codes are upstream's: 0 success, 1 validation error, 2 I/O error,
3 internal error, 4 usage error.

## Build

`build.sh` runs `scripts/build-wasip1-go-command.sh`: upstream's tag
v0.5.2 (commit 802abaa), unpatched, built with Go 1.27.3,
`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 -trimpath -buildvcs=false` and
`-ldflags='-s -w -buildid= -X main.version=0.5.2'`. `okf version` prints
0.5.2; the commit and date that upstream's release builds also stamp are
left out so the build is reproducible.

The command sets `"preopenRoot": true` (slicc-kernel 1.30.0 and later), so
a bundle anywhere, a working directory of `/`, and a missing path give the
answers they give on Linux. Without it, Go reports a missing top-level path
as `Bad file number` (slicc-kernel#1868).

## Licence

okf is Apache-2.0 (`LICENSE`). `okf.wasm` statically links the Go runtime
(BSD-3-Clause) and gopkg.in/yaml.v3 (MIT AND Apache-2.0); their licences are
in `THIRD-PARTY-NOTICES.md`.
