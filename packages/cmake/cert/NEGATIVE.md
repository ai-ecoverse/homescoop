# Negative proof (cmake)

**Date:** 2026-10-19, for 4.4.3-10, the package's first cert (homescoop#426, #859 stage G). Run with `node scripts/browser-cert/run.mjs --package cmake --users enforce` on slicc-kernel 1.110.7, darwin-arm64.

## Supply chain
4.4.3-9 relinked objects from a local `slicc-emscripten/build/cmake-wasm-build` (2026-09-24). That build had no provenance, and its libuv and CMAKE_ROOT patches only lived in that checkout. `repack-input.mjs` reports it as unattested: "can take a tree outside the repo ($ROOT/..)" and "never fetches the pinned source". 4.4.3-10 fetches the cmake 4.4.3 release tarball by sha256 and applies three patches, all now in `packages/cmake/`:
- `libuv-emscripten.patch` re-derives the libuv port. libuv has no Emscripten platform: it now gets the posix poll backend and no thread names. `uv_spawn` starts children through `slicc_spawn_capture`, because the realm has no fork. Without that, `execute_process` fails with "function not implemented".
- `cmake-root-env.patch` makes CMAKE_ROOT from the environment win over the executable's install tree.
- `host-emscripten-is-wasi.patch` makes CMakeDetermineSystem map the Emscripten host to WASI.

The build itself is emcmake from the patched emscripten 6.0.9 tree, linked against today's `shims/slicc`.

## The published 4.4.3-9 fails cert/cmake.mjs
```text
AssertionError: cmake.wasm does not import slicc_cred_js (today's shims/slicc)
```
-9's `-E`, `-P`/`execute_process`, configure and gmake build rows pass. Its shims predate the credential library (#459) and the inherited-ignore seed (#973), so its glue names neither `slicc_cred_js` nor `slicc_sig_inherited_js`. 4.4.3-10 passes every row.

## 4.4.3-11: the burn-down (homescoop#1278, #1279, #1280, #844; 2026-10-20)

On slicc-kernel 1.110.7, users enforce, the published 4.4.3-10 gives:

| case | 4.4.3-10 | 4.4.3-11 |
|---|---|---|
| `project(… LANGUAGES NONE)`: `CMAKE_SYSTEM_NAME`, `WASI`, `UNIX` (#1278) | `Linux`, `WASI=`, `UNIX=1` | `WASI`, `WASI=1`, `UNIX=` |
| `file(DOWNLOAD http://cert.test/f.txt …)` (#1280) | no result in 15 minutes | `0`, the served bytes |
| `file(DOWNLOAD https://…)` (#1280) | — | `1;"Unsupported protocol"` (documented) |
| `THIRD-PARTY-NOTICES.md` (#1279, #844) | missing | Emscripten plus 12 bundled libraries |

- **#1278, the cause:** today's `shims/slicc` sends `uname()` to the kernel, which answers `Linux 6.0.0-slicc`. CMakeDetermineSystem also runs `uname -r`/`-m` after the patch's old position. The patch now runs after that detection, and maps both Emscripten and a Linux whose version names slicc to WASI.
- **#1280, the cause:** cmake.wasm didn't link `slicc_socket.c`, so CMake's curl used Emscripten's WebSocket sockets, which go nowhere in slicc. It's linked now. https needs a TLS backend for CMake's bundled curl, which this package doesn't have; the README says so and gives the workaround.

## 4.4.3-12: shim drift (homescoop#1491; 2026-10-20)

4.4.3-12 links the updated `shims/slicc`: a failed posix_spawn `open()` file action returns its errno (#1302), an empty `envp` stays empty, getaddrinfo reads `/etc/hosts` first (#580), `slicc-env.js` builds the environment from the kernel's values only, and on kernels that don't answer uname(2) the node name comes from `/etc/hostname`, `HOSTNAME`, then `slicc`. On #1491, npm-parity found that the build differs from the published 4.4.3-11 in `bin/cmake` and `bin/cmake.wasm`, so this is a packaging bump. The package's own code is unchanged. The behaviour tests are `shims/slicc/test`'s spawn, resolve and uname tests.

## 4.4.3-13: the shims notice and slicc-env.js (homescoop#1533, #1501, #1281; 2026-10-21)

On slicc-kernel 1.110.7, users enforce, the published 4.4.3-12 gives:

| case | 4.4.3-12 | 4.4.3-13 |
|---|---|---|
| `env -i /usr/bin/cmake -E environment` (#1501, `cert/env-i.mjs`) | `USER=web_user`, `LOGNAME=web_user`, `PATH=/`, `PWD=/`, `HOME=/home/web_user`, `LANG=en_US.UTF-8`, `_=cmake`, plus the kernel's `CMAKE_ROOT` and `HOSTNAME` | only what the kernel passes: no web_user, `PATH=/`, HOME, USER, LOGNAME or LANG |
| `THIRD-PARTY-NOTICES.md` shims section (#1533, `cert/platform.mjs`) | missing | `## homescoop: the slicc shims (shims/slicc, Apache-2.0)` with the Apache-2.0 text |
| `cert/downloads.mjs` (#1281 coverage) | passes | passes |

- **#1501, the cause:** build.sh passes its own `--js-library` list, and it named slicc-writev.js, slicc-linkat.js and slicc-uname.js but not `shims/slicc/slicc-env.js`, so Emscripten's stock `getEnvStrings` filled in its placeholders. The link now adds slicc-env.js itself (not wasm-emscripten's link.py default from its package-patches), and the glue QC fails if the glue still names `web_user`.
- **#1533, the cause:** build.sh compiles the shims itself, outside `homescoop_slicc_archive`, so no shims section was written, and `KNOWN_WITHOUT_SHIM_NOTICE` let it through under the closed #844. build.sh now calls `homescoop_notice_slicc_shims`, and the entry is gone, so `scripts/test/shim-notice.test.mjs` fails if the call goes missing again.
- **#1281, partly:** `platform.mjs` now checks all 12 bundled-library notices (adding `cmllpkgc`), and `downloads.mjs` covers a binary download with `EXPECTED_HASH`, a hash mismatch, a 302, `TIMEOUT` and the `-DCMAKE_SYSTEM_NAME=Linux` override. A real C/C++ project with wasm-clang is still open.

## 4.4.3-14: https through wasm-curl's libcurl (homescoop#1280, #1281; 2026-10-25)

4.4.3-13 merged (#1624), but it was never published: ladder-merge run 39710872428 got a 503 from the registry and refused to publish. npm latest is 4.4.3-12, and its curl is the same bundled TLS-less cmcurl as 4.4.3-13's. Run with `node scripts/browser-cert/run.mjs --package cmake --kernel @ai-ecoverse/slicc-kernel@1.110.7 --users enforce` on darwin-arm64:

| case | 4.4.3-12 (npm latest) | 4.4.3-14 |
|---|---|---|
| `file(DOWNLOAD https://cert.test/f.txt …)` with no TLS setting (`cert/https.mjs`) | `1;"Unsupported protocol"`, an empty file | `0;"No error"`, the served bytes, verified against the kernel CA through `SSL_CERT_FILE` |
| `FetchContent_MakeAvailable` with `URL https://cert.test/dep.tar` and `URL_HASH` | not reached (the row above fails first) | fetched, unpacked and added |
| a CA that did not sign the certificate, through `TLS_CAINFO`, `TLS_VERIFY ON`, `CMAKE_TLS_CAINFO` or `SSL_CERT_FILE` | — | `60;"SSL peer certificate or SSH remote key was not OK…"`; FetchContent's configure fails |
| `TLS_VERIFY OFF` with that CA | — | `0`, the served bytes |
| `CURL_CA_BUNDLE` only (`SSL_CERT_FILE` empty) | — | `60` (CMake reads only `SSL_CERT_FILE` and `SSL_CERT_DIR`) |
| `cert/env-i.mjs`: `cmake -P` as builder prints `HOME`, `USER`, `PATH` and `~` (#1281, coverage) | fails earlier, on 4.4.3-13's row (`USER=web_user`, #1501) | passes |
| `cert/platform.mjs`: the notices name curl, Mbed TLS and zlib from wasm-curl/wasm-zlib, and no `cmcurl`, `cmnghttp2` or `cmzlib` | fails (`## curl / libcurl 8.22.0` missing) | passes |

4.4.3-12's failure on `cert/https.mjs`:

```text
AssertionError [ERR_ASSERTION]: file(DOWNLOAD https://…) with verification on, through SSL_CERT_FILE (homescoop#1280): -- verify [] [] cainfo []
-- https 1;"Unsupported protocol" e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

- **#1280, the cause:** build.sh configured with `-DCMAKE_USE_OPENSSL=OFF`, so the bundled cmcurl had no TLS backend. 4.4.3-14 configures with `-DCMAKE_USE_SYSTEM_CURL=ON` against wasm-curl 8.22.0-10's `libcurl.a` and Mbed TLS archives. That forces `CMAKE_USE_SYSTEM_ZLIB`, so wasm-zlib 1.3.1-4 is linked too. It links `shims/slicc/webcrypto-entropy.c` for Mbed TLS's entropy. The build fails if `Utilities/cmcurl` is still linked.
- **TLS behaviour** is CMake 4.4.3's own. Verification is on, TLS 1.2 is the minimum, and the CA comes from `TLS_CAINFO`, then `CMAKE_TLS_CAINFO`, then `SSL_CERT_FILE`, then `SSL_CERT_DIR`. The README has the details.
- All five specs (`cmake.mjs`, `downloads.mjs`, `env-i.mjs`, `https.mjs`, `platform.mjs`) pass on 4.4.3-14 on slicc-kernel 1.110.7. `https.mjs` also passes on 1.166.4, the root devDependency.
