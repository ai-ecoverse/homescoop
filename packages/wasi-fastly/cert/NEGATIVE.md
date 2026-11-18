# Negative proof (wasi-fastly)

**Date:** 2026-11-17

Each build below is the pinned source `fastly/cli@3e9473d248429bad874e848281f0e91ad6f41ea8`
(v17.1.0), vendored as `build.sh` does it, with one patch left out, built
with Go 1.27.3 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 go build -mod=vendor
-trimpath -buildvcs=false` and the recipe's ldflags), packed with this
`package/` and run through `scripts/browser-cert/run.mjs` on the cert kernel
(slicc-kernel 1.189.2, users enforce). With all four patches every spec
passes (`cert-run: PASS wasi-fastly pass`).

## Without `0001-wasip1-build.patch`

The build fails, so there is no fastly.wasm:

```text
# github.com/mitchellh/go-ps
vendor/github.com/mitchellh/go-ps/process.go:31:9: undefined: processes
vendor/github.com/mitchellh/go-ps/process.go:39:9: undefined: findProcess
# github.com/otiai10/copy
vendor/github.com/otiai10/copy/copy_namedpipes.go:16:17: undefined: syscall.Mkfifo
vendor/github.com/otiai10/copy/preserve_ltimes.go:10:19: undefined: unix.Stat_t
vendor/github.com/otiai10/copy/preserve_ltimes.go:11:17: undefined: unix.Lstat
vendor/github.com/otiai10/copy/preserve_ltimes.go:15:14: undefined: unix.Lutimes
vendor/github.com/otiai10/copy/preserve_ltimes.go:15:35: undefined: unix.Timeval
vendor/github.com/otiai10/copy/preserve_ltimes.go:16:8: undefined: unix.NsecToTimeval
vendor/github.com/otiai10/copy/preserve_ltimes.go:17:8: undefined: unix.NsecToTimeval
vendor/github.com/otiai10/copy/stat_times.go:17:31: stat.Atim undefined (type *syscall.Stat_t has no field or method Atim)
vendor/github.com/otiai10/copy/stat_times.go:18:31: stat.Ctim undefined (type *syscall.Stat_t has no field or method Ctim)
```

## Without `0002-wasip1-slicc-host.patch`

It builds (and imports no `fastly_host`). Go's own transport tries the
kernel's proxy, which wasip1 cannot dial. checklist.mjs, config.mjs and
z-missing-host.mjs fail:

```text
browser-cert: FAIL packages/wasi-fastly/cert/checklist.mjs
ERROR: Get "https://api.fastly.com/service?direction=ascend&page=1&per_page=100&sort=created": proxyconnect tcp: dial tcp 127.0.0.1:3128: address 127.0.0.1:3128: connect: Connection refused.
browser-cert: FAIL packages/wasi-fastly/cert/config.mjs
ERROR: token validation failed: neither /current_user nor /tokens/self responded successfully: Get "https://api.fastly.com/current_user": proxyconnect tcp: dial tcp 127.0.0.1:3128: address 127.0.0.1:3128: connect: Connection refused.
browser-cert: ok packages/wasi-fastly/cert/unavailable.mjs
browser-cert: FAIL packages/wasi-fastly/cert/z-missing-host.mjs
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /needs slicc-kernel with @ai-ecoverse\/wasi-fastly's host module/.
cert-run: FAIL wasi-fastly fail
```

## Without `0003-wasip1-unavailable-commands.patch`

The update check asks developer.fastly.com for a wasip1 release after each
command (the stub offers v99.0.0), and compute build starts building.
checklist.mjs, config.mjs and unavailable.mjs fail:

```text
browser-cert: FAIL packages/wasi-fastly/cert/checklist.mjs
The input did not match the regular expression /^Fastly CLI version v17\.1\.0 \(3e9473d\)\nBuilt with go version …\n$/. Input:
'Fastly CLI version v17.1.0 (3e9473d)\n' +
  'Built with go version go1.27.3 wasip1/wasm (2026-11-17)\n' +
  '\n' +
  'A new version of the Fastly CLI is available.\n' +
browser-cert: FAIL packages/wasi-fastly/cert/config.mjs
[{"method":"GET","url":"https://api.fastly.com/service?direction=ascend&page=1&per_page=100&sort=created","key":"stored-token",…},{"method":"GET","url":"https://developer.fastly.com/api/internal/releases/meta/cli/wasip1/wasm","key":"",…}]
2 !== 1
browser-cert: FAIL packages/wasi-fastly/cert/unavailable.mjs
AssertionError [ERR_ASSERTION]: fastly compute build
  actual: 'IMPORTANT: The Fastly CLI is configured to collect data related to Wasm builds …\n' +
    '| Verifying fastly.toml...\n' +
    '✓ Verifying fastly.toml\n' +
    '| Fetching latest wasm-tools release...\n' +
    '✗ Fetching latest wasm-tools release\n' +
browser-cert: ok packages/wasi-fastly/cert/z-missing-host.mjs
cert-run: FAIL wasi-fastly fail
```

## Without `0004-lazy-oidc-metadata.patch`

Every command with a token first asks accounts.fastly.com for its OpenID
Connect metadata. The stub answers that with 500, so service list fails
before its own request. checklist.mjs and config.mjs fail:

```text
browser-cert: FAIL packages/wasi-fastly/cert/checklist.mjs
ERROR: failed to configure authentication processes: the Fastly servers are unresponsive, please check the Fastly Status page (https://fastlystatus.com) and reach out to support if the error persists (HTTP Status Code: 500, Error Message: {"error":"accounts.fastly.com is down in this cert"}).
browser-cert: FAIL packages/wasi-fastly/cert/config.mjs
ERROR: failed to configure authentication processes: the Fastly servers are unresponsive, … (HTTP Status Code: 500, …).
browser-cert: ok packages/wasi-fastly/cert/unavailable.mjs
browser-cert: ok packages/wasi-fastly/cert/z-missing-host.mjs
cert-run: FAIL wasi-fastly fail
```
