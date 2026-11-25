# Negative proof (wasi-fastly)

## 17.2.0-1: version and commit from recipe.yaml, vcl check/run, vcl serve refused

**Date:** 2026-11-25

`checklist.mjs` and `test/e2e/fastly.test.mjs` now take the version and
the short commit from `recipe.yaml` (`cert/lib/version.mjs`: `version`,
`source.commit`, `source.tag`), so a Renovate bump needs no spec edit.
`unavailable.mjs` and the e2e test refuse `fastly vcl serve` (new in
fastly 17.2.0; 0003 now lists it), and `vcl.mjs` covers `vcl check` and
`vcl run` against `fiddle.fastly.dev` with no token sent. These were run
locally with `test/e2e/fastly.test.mjs` as changed here (slicc-kernel
1.189.2, Node entry) and `cert/vcl.mjs` driven by the same Node kernel
(`id` and `stat` answered from the kernel's file system, no users), with
`cert/lib/stub.mjs` as the far end. CI's browser cert runs them for real.

The previously published `@ai-ecoverse/wasi-fastly@17.1.0-1` (fastly.wasm
sha256 `b159f3123f26e23baf02c58f4bf2862b224974841c0b9821b4dc8db10e7fad31`)
fails 4 of the 8 e2e tests and `vcl.mjs`:

```text
✖ fastly version and --help run without the network
  The input did not match the regular expression /^Fastly CLI version v17\.2\.0 \(23a945d\)\nBuilt with go version go1\.\d+\.\d+ wasip1\/wasm \(\d{4}-\d\d-\d\d\)\n$/. Input:
  'Fastly CLI version v17.1.0 (3e9473d)\n' +
    'Built with go version go1.27.3 wasip1/wasm (2026-11-25)\n'
✖ FASTLY_API_TOKEN reaches api.fastly.com as Fastly-Key, and nothing else is asked (sync host)
  The input did not match the regular expression /^FastlyCLI\/v17\.2\.0, FastlyGo\//. Input:
  'FastlyCLI/v17.1.0, FastlyGo/19.2.0 (+github.com/fastly/go-fastly; go1.27.3)'
✖ FASTLY_API_TOKEN reaches api.fastly.com as Fastly-Key, and nothing else is asked (async host)
  (the same User-Agent)
✖ commands that need a native toolchain, a local port or a new binary refuse with a reason
  fastly vcl serve recv.vcl: ERROR: error parsing arguments: expected command but got serve.
cert/vcl.mjs: fastly vcl check recv.vcl prints the vcl usage and exits 1 (17.1.0 has no vcl check)
```

CI's 17.2.0-1 build of Renovate's head, without the `vcl serve` refusal
(run 45512465618, `host-wasi-fastly-pr2228` package.tgz sha256
`a799d9a2345918eba408940753593c96a34d0896d04a70f9e89b7036e9d7efa6`),
passes the version, User-Agent and `vcl.mjs` rows and fails the refusal.
`vcl serve` publishes the VCL first. Against the e2e test's transport it
fails at the sandbox, and against `cert/lib/stub.mjs`, which answers, it
creates the sandbox, executes it, reads the result stream and then does
not return (still running after 20 s):

```text
✖ commands that need a native toolchain, a local port or a new binary refuse with a reason
  fastly vcl serve recv.vcl
  actual: 'INFO: Deploying VCL to a test sandbox... (this can take a minute to reach the edge)\n\nERROR: sandbox returned 503 Service Unavailable: {"msg":"not reachable in this test: fiddle.fastly.dev"}.\n…'
REQ POST https://fiddle.fastly.dev/fiddle -> 200
REQ POST https://fiddle.fastly.dev/fiddle/cert-fiddle/execute?cacheID=772624848 -> 200
REQ GET https://fiddle.fastly.dev/results/cert-session/stream -> 200
"STILL RUNNING after 20s"
```

The same build fails main's hard-coded `checklist.mjs` in CI's cert (run
45512465618):

```text
browser-cert: FAIL packages/wasi-fastly/cert/checklist.mjs
The input did not match the regular expression /^Fastly CLI version v17\.1\.0 \(3e9473d\)\nBuilt with go version go1\.\d+\.\d+ wasip1\/wasm \(\d{4}-\d\d-\d\d\)\n$/. Input:
'Fastly CLI version v17.2.0 (23a945d)\n' +
  'Built with go version go1.27.3 wasip1/wasm (2026-11-24)\n'
```

`scripts/test/wasi-fastly-cert-version.test.mjs` fails 3 of its 11 tests
on Renovate's head (its specs, `package.json` and 0003): the stale
`homescoop.source` (`fastly/cli@3e9473d…`), `cert/checklist.mjs pins a
version in a regex`, and no `vcl serve` entry in 0003.

## 17.1.0-1: the four patches

**Date:** 2026-11-17

Each build below is the pinned source `fastly/cli@3e9473d248429bad874e848281f0e91ad6f41ea8`
(v17.1.0), vendored as `build.sh` does it, with one patch left out, built
with Go 1.27.3 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 go build -mod=vendor
-trimpath -buildvcs=false` and the recipe's ldflags), packed with this
`package/` and run through `scripts/browser-cert/run.mjs` on the cert kernel
(slicc-kernel 1.189.2, users enforce). With all four patches every spec
passes (`cert-run: PASS wasi-fastly pass`).

### Without `0001-wasip1-build.patch`

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

### Without `0002-wasip1-slicc-host.patch`

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

### Without `0003-wasip1-unavailable-commands.patch`

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

### Without `0004-lazy-oidc-metadata.patch`

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
