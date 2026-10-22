# Negative proof (curl)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`.

## Empty wasm

With `bin/curl.wasm` truncated to 0 bytes, the checklist fails at the first
`curl` (slicc-kernel 1.23.0, Node entry):

```
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## Known-bad build: curl without zlib

`build.sh` with `-DCURL_ZLIB=OFF` (built locally, not committed) fails the
checklist at `curl --version` (no `zlib/1.3.1`). With that assertion
removed, it fails again at `--compressed`:

```
curl -sS --compressed https://cert.test/gz: rc=2 stderr=curl: option --compressed: the installed libcurl version does not support this
```

## Spec non-vacuous

Without the `wasm-tls-engine` peer, the kernel answers `CONNECT` with 501
and every https case fails (`curl: (7) CONNECT tunnel failed, response
501`). The spec compares response bodies and exit codes exactly (22, 47, 60,
77, 1, 23), checks the downloaded binary by sha256, and asserts that the
decoy CA is rejected while `-k` accepts it.

The published 8.22.0-1 also passes the checklist, so the new build shows no
regression on these cases.

## Tailnet names (8.22.0-3, homescoop#139)

`cert/tailnet.mjs` against the published 8.22.0-2 (socket shim without the
kernel resolver), slicc-kernel 1.28.0 with the fake uplink:

```
rc=6 stderr=curl: (6) Could not resolve: peer.tail1234.ts.net:8080
```

## Own hostname (8.22.0-4, #149)

The published 8.22.0-3 (#140's shim) sends the machine's own name to the
uplink, which does not know it:

```
emscripten:1 rc=6 stderr=curl: (6) Could not resolve: emscripten:1
```

## The slicc shims and credentials (8.22.0-4, #459, #625)

`8.22.0-4`'s `bin/curl.wasm` exports none of the slicc shims' symbols and imports nothing from them. CMake's Release type adds `-O3` to the link line, and `emcc -O3` drops their `EMSCRIPTEN_KEEPALIVE` exports, so the `--whole-archive` net shims and the credential library never reach the binary. On main, host-run's `check-slicc-cred.mjs` therefore refused to build curl:

```text
homescoop: bin/curl.wasm (an Emscripten command) lacks the slicc credential library (import slicc_cred_js, export slicc_cred_euid): slicc-kernel shows every file as 1000:1000 under users (homescoop#459)
  check-slicc-cred: 0 of 1 wasm link the slicc shims; 1 Emscripten command wasm; 1 problem(s)
```

8.22.0-5 builds with `CMAKE_C_FLAGS_RELEASE=-DNDEBUG`, so it compiles and links at `-O2`. Its wasm exports `slicc_sig_mask`, `slicc_raise`, `slicc_sigpipe` and `slicc_cred_euid`, and imports `slicc_cred_js` and the net shims' `slicc_socket_js`, `slicc_poll_js` and the rest.

## users.mjs (users enforce, #723)

**Date:** 2026-10-16, slicc-kernel 1.102.6 `--users enforce`.

- `prove-negative.mjs --package curl --spec users.mjs --users enforce` → FAIL
  (`WebAssembly.compile(): BufferSource argument is empty`).
- The npm build without the credential library (curl 8.22.0-4, qpdf
  12.4.2-1) passes users.mjs on 1.102.6 too: the kernel refuses the opens
  and stamps the creator's ids itself. The spec guards the behaviour as a
  non-root user; host-run's `check-slicc-cred.mjs` guards the link. That
  build fails glue-by-path (0644 glue, `EACCES`).

## 8.22.0-7: no DWARF, no build paths (homescoop#908; 2026-10-17)

The published 8.22.0-6 also has 26 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/curl.wasm, lib/libmbedtls.a (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

8.22.0-7 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 8.22.0-6 too; the negative is the #908 check.

## 8.22.0-8: curl -n without HOME (homescoop#724; 2026-10-20)

`cert/netrc.mjs` against a build of main (the published 8.22.0-7's recipe), on slicc-kernel 1.102.6 under users enforce: FAIL, 1 of 3 assertions. `env -u HOME curl -n` gives `curl: (26) .netrc error: no such file`. A probe in the same session shows the cause: with `HOME` unset, a program's environment has `HOME=/home/web_user` (`env -u HOME bash -c 'echo $HOME'`), Emscripten's `getEnvStrings` placeholder, so curl never reached its `getpwuid_r` fallback. With `packages/coreutils/slicc-env.js` linked (#612's fix), all four specs pass.

## 8.22.0-9: shim drift (homescoop#1491; 2026-10-20)

8.22.0-9 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 8.22.0-8 in `bin/curl` and `bin/curl.wasm`, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.

## 8.22.0-10: the shared slicc-env.js (homescoop#1625), env and /etc/hosts specs (homescoop#1434; 2026-10-21)

The build change is in `build.sh` and `recipe.yaml`: curl stops naming `packages/coreutils/slicc-env.js` and links `shims/slicc/slicc-env.js` through `homescoop_em_cli_ldflags`. The published 8.22.0-9 already links an identical environment library, so its behaviour matches and it passes both new specs. The negative for the build change is `scripts/test/recipe-inputs.test.mjs`: on main it fails with `packages/curl/build.sh: packages/coreutils/slicc-env.js` and `packages/curl/recipe.yaml: packages/coreutils/slicc-env.js`. With coreutils' copy removed, it also fails because that recipe input is missing. `build.sh` also fails a glue that has Emscripten's `USER:"web_user"` table. 8.22.0-7's `bin/curl` has it (`var env={USER:"web_user",LOGNAME:"web_user",PATH:"/",PWD:"/",HO…`) and 8.22.0-9's doesn't.

Local runs with `run.mjs --users enforce --soft --spec envhome.mjs --spec hosts.mjs` on slicc-kernel 1.102.6, against the published tarballs:

- 8.22.0-9: both pass.
- 8.22.0-7, `envhome.mjs`: FAIL, 6 of 11 assertions. `env -u HOME curl` sends `X-Rc: web_user` from root's decoy `/home/web_user/.curlrc`. `env -i curl -n` sends `Authorization: Basic dzp3` (w:w, the decoy `.netrc`). `env -i curl` sees `HOME=/home/web_user`. bob's `env -u HOME curl -n` gets rc 0 and sends `Basic dzp3`.
- 8.22.0-8, `hosts.mjs`: FAIL, 10 of 19 assertions. `alias.review.test.` and `ALIAS.test` give `curl: (6) Could not resolve` and dial nothing, because that build's getaddrinfo doesn't read `/etc/hosts` (#580 came with 8.22.0-9's shims). 8.22.0-7 fails it the same way. 8.22.0-8 passes `envhome.mjs`.
