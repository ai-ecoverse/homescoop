# Negative proof (wasi-ntfy)

**Date:** 2026-10-18. Kernel `@ai-ecoverse/slicc-kernel@1.125.4`, users
enforce, specs from this PR. Pinned source
`binwiederhier/ntfy@9d0b6d933d6a6ddc5265bfecadaec1fb1538d89b` (v2.32.0),
Go 1.27.1.

There is no earlier `@ai-ecoverse/wasi-ntfy` release (only the 0.0.0
placeholder that holds the name), so the negatives are builds without the
patches.

## Without either patch: no build

`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 go build -trimpath -buildvcs=false
-tags noserver .` exits 1 and writes no `ntfy.wasm`. These are the errors
`0001-wasip1-slicc-host.patch` removes:

```text
# heckel.io/ntfy/v2/cmd
cmd/publish.go:87:5: undefined: clientCommandDescriptionSuffix
cmd/publish.go:301:6: undefined: processExists
cmd/publish.go:306:6: undefined: processExists
cmd/subscribe.go:82:5: undefined: clientCommandDescriptionSuffix
cmd/subscribe.go:260:92: undefined: scriptExt
cmd/subscribe.go:262:11: undefined: scriptHeader
cmd/subscribe.go:268:22: undefined: scriptLauncher
exit 1
```

## Without `0002-gateway-contract.patch`

The build used only `0001-wasip1-slicc-host.patch`, with the recipe's flags
(`ntfy.wasm` sha256
`825f44efddb9e9cf87198938ed3ed393925bd98975b0dfa0504f649e0c5e4eb0`). It was
packed into this package's tarball in place of the real `bin/ntfy.wasm` and
run through `node scripts/browser-cert/run.mjs --package wasi-ntfy --tarball
<that tgz>`, giving `cert-run: FAIL wasi-ntfy fail`. `checklist.mjs` and
`z-missing-host.mjs` pass, because they cover the first patch. Every spec
that maps to the second patch fails:

- `auth.mjs`: `ntfy sub` with a forged token doesn't stop. Upstream retries
  the 401 every 10 s until coreutils `timeout 90` ends it: `124 !== 1`, with
  nine `WARN ntfy.test/alerts Connection failed: {"code":40101,…}` lines,
  10 s apart.
- `ratelimit.mjs`: the publish answered 429 `retry-after: 3` isn't sent
  again. Upstream exits 1 with
  `{"code":42901,"http":429,"error":"limit reached: too many requests"}`
  (`1 !== 0`).
- `reconnect.mjs`: after each drop, upstream resubscribes with its original
  `since=all`, so the command runs for `m2` twice:

  ```text
  + 'm1 one\nm2 two\nm2 two\nm3 three\nm4 four\n'
  - 'm1 one\nm2 two\nm3 three\nm4 four\n'
  ```

  Without `--since`, upstream's reconnect asks for nothing it missed, so the
  messages published during the gap are lost.
- `size.mjs`: a 1 MiB + 1 byte stdin message is cut to 1 MiB without a word
  and published. The exit is 0, where the patched client refuses it
  (`actual: 0, expected: 0, operator: 'notStrictEqual'`).

## Without the yield in `slicchost` (part of 0001)

`test/e2e/ntfy.test.mjs` sends a message's next line only after that
message's command has acked with a nested `ntfy pub`. With the
`runtime.Gosched()` before each blocking `http.read` removed, the server
sees `GET /live/json` and never sees the ack. wasip1 Go runs one thread, and
the subscribe goroutine blocks in the host call before the main goroutine
can run the command, so the test hangs until it times out. With the yield,
the acks for `m1` and `m2` arrive about 100 ms apart, while the stream is
still open.
