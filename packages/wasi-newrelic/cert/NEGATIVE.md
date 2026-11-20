# Negative proof (wasi-newrelic)

**Date:** 2026-11-20

Each build below is the pinned source `newrelic/newrelic-cli@05ba094109ac9db08c72c6e13f213ee8c58f0959`
(v0.117.0), vendored as `build.sh` does it, with one patch left out, built
with Go 1.27.4 (`GOOS=wasip1 GOARCH=wasm CGO_ENABLED=0 go build -mod=vendor
-trimpath -buildvcs=false` and the recipe's ldflags), packed with this
`package/` and run through `scripts/browser-cert/run.mjs` on the cert kernel
(slicc-kernel 1.191.4, users enforce). With all three patches every spec
passes (`cert-run: PASS wasi-newrelic pass`).

## Without `0001-wasip1-build.patch`

The build fails, so there is no newrelic.wasm:

```text
# github.com/AlecAivazis/survey/v2/terminal
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:26:17: undefined: syscall.Termios
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:48:43: undefined: syscall.SYS_IOCTL
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:48:81: undefined: ioctlReadTermios
vendor/github.com/AlecAivazis/survey/v2/terminal/runereader_posix.go:53:29: undefined: syscall.ECHO
…
# github.com/sirupsen/logrus
vendor/github.com/sirupsen/logrus/terminal_check_notappengine.go:13:10: undefined: isTerminal
# mvdan.cc/sh/v3/interp
vendor/mvdan.cc/sh/v3/interp/os_unix.go:19:14: undefined: unix.Mkfifo
```

With the build files only, and not `survey.Ask`'s wasip1 refusal (the first
build of this recipe), `newrelic profile add --profile p2 --apiKey … --region US
--licenseKey L` in seven's terminal (slicc-kernel 1.191.2) printed
`? Account ID:`, asked the terminal for the cursor position, and hung; the
terminal's answer sat in the cooked line (`^[[69;42R`) until ^C. The
prompt case in config.mjs checks that this build fails at once instead,
with no question and no `ESC [6n` written.

## Without `0002-wasip1-slicc-host.patch`

It builds (and imports no `newrelic_host`). Go's own transport tries the
kernel's proxy, which wasip1 cannot dial, and newrelic-client-go retries it
three times. The config directory and credentials.json keep the kernel's
default modes. checklist.mjs, config.mjs and z-missing-host.mjs fail:

```text
browser-cert: FAIL packages/wasi-newrelic/cert/checklist.mjs
AssertionError [ERR_ASSERTION]: level=fatal msg="POST https://api.newrelic.com/graphql giving up after 4 attempt(s): Post \"https://api.newrelic.com/graphql\": proxyconnect tcp: dial tcp 127.0.0.1:3128: address 127.0.0.1:3128: connect: Connection refused"
browser-cert: FAIL packages/wasi-newrelic/cert/config.mjs
+ '755 1000 /home/cone/.newrelic\n' +
+   '644 1000 /home/cone/.newrelic/credentials.json\n'
- '700 1000 /home/cone/.newrelic\n' +
-   '600 1000 /home/cone/.newrelic/credentials.json\n'
browser-cert: ok packages/wasi-newrelic/cert/unavailable.mjs
browser-cert: FAIL packages/wasi-newrelic/cert/z-missing-host.mjs
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /needs slicc-kernel with @ai-ecoverse\/wasi-newrelic's host module/.
cert-run: FAIL wasi-newrelic fail
```

## Without `0003-wasip1-unavailable-commands.patch`

`newrelic install` asks NerdGraph for the account's license key (an
`apiAccess.keySearch` query) and, since the stub has no answer for it,
retries for upstream's five minutes, so the page call times out.
z-missing-host.mjs then sees that install's requests still arriving.
checklist.mjs and config.mjs pass:

```text
browser-cert: ok packages/wasi-newrelic/cert/checklist.mjs
browser-cert: ok packages/wasi-newrelic/cert/config.mjs
browser-cert: FAIL packages/wasi-newrelic/cert/unavailable.mjs (crash at ?)
Error: Runtime.evaluate: no answer in 120000 ms
browser-cert: FAIL packages/wasi-newrelic/cert/z-missing-host.mjs
+ [ { body: '{"query":"query($query: ApiAccessKeySearchQuery!, $cursor: String) {…', key: 'NRAK-SEALEDPLACEHOLDER000000000', method: 'POST', url: 'https://api.newrelic.com/graphql' }, …
cert-run: FAIL wasi-newrelic fail
```

The same build's `newrelic diagnose run` and `diagnose lint` (Node entry,
slicc-kernel 1.191.4) create `~/.newrelic/bin` and stop on the platform:

```text
level=info msg="nrdiag binary not found in /home/app/.newrelic/bin/nrdiag"
level=info msg="Determining OS..."
level=fatal msg="unknown operating system: wasip1"
```
