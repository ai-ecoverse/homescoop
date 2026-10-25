# `@ai-ecoverse/wasm-cmake`

CMake 4.4.3 for slicc's wasm realm, built in CI from the release tarball with
the patched emscripten 6.0.9 tree and linked against libslicc (spawn,
select/poll for libuv, sockets, signals, kernel credentials) and wasm-curl's
libcurl with Mbed TLS, so https downloads work. Honors `CMAKE_ROOT` (manifest default:
`${package}/share/cmake-4.4`) so modules resolve when argv0 is `/usr/bin/cmake`.

```bash
pnpm add -g @ai-ecoverse/wasm-cmake
cmake -E echo hello
cmake -P script.cmake
```

## Platform

In slicc the host is **WASI**: `CMAKE_SYSTEM_NAME` is `WASI`, `WASI` is set and
`UNIX` isn't, so `Platform/WASI.cmake` applies and executables are bare `.wasm`
modules that run in slicc's realm (`try_run` works). Pass
`-DCMAKE_SYSTEM_NAME=…` to choose another platform.

## Downloads

`file(DOWNLOAD)`, `file(UPLOAD)`, and `FetchContent`/`ExternalProject` with a
`URL http://…` or `URL https://…` go through slicc's network. Since 4.4.3-14,
`cmake.wasm` is linked against the libcurl 8.22.0 from
[`@ai-ecoverse/wasm-curl`](https://www.npmjs.com/package/@ai-ecoverse/wasm-curl),
which has Mbed TLS 3.6.5. It no longer uses CMake's bundled curl, which had no TLS
backend here. Up to 4.4.3-13, `file(DOWNLOAD https://…)` returned
`1;"Unsupported protocol"` (homescoop#1280).

### TLS defaults

These are CMake 4.4.3's upstream defaults, unchanged:

- **Verification is on.** `TLS_VERIFY` on the call wins. Without it, the
  `CMAKE_TLS_VERIFY` variable applies, then the `CMAKE_TLS_VERIFY` environment
  variable. If none of them is set, the server certificate is verified.
- **TLS 1.2 or later.** `TLS_VERSION`, then the `CMAKE_TLS_VERSION` variable,
  then the environment variable, then `1.2`.
- **The CA bundle.** `TLS_CAINFO` on the call comes first, then the
  `CMAKE_TLS_CAINFO` variable, then the `SSL_CERT_FILE` environment variable (if
  the file exists), then `SSL_CERT_DIR` (if the directory exists). Without any of
  them, libcurl's built-in default applies, and wasm-curl's libcurl has none, so
  nothing is trusted and every https download fails with
  `60;"SSL peer certificate or SSH remote key was not OK…"`. CMake's own
  fallback to `/etc/pki/tls/certs/ca-bundle.crt` and
  `/etc/ssl/certs/ca-certificates.crt` exists only in builds with its bundled
  curl, so it isn't used here either.

### A CA bundle in seven

slicc-kernel starts every program with `https_proxy` pointing at its proxy.
The proxy terminates TLS with a certificate from the kernel's own CA. The kernel
also sets `SSL_CERT_FILE`, `CURL_CA_BUNDLE` and `GIT_SSL_CAINFO` to that CA's
bundle, `/etc/ssl/certs/slicc-kernel-ca.pem`. So `file(DOWNLOAD https://…)` and
`FetchContent` verify out of the box, with nothing to set.

To trust another CA, for example a local https server that `no_proxy` reaches
directly:

- `export SSL_CERT_FILE=/path/to/ca.pem` for every cmake run. CMake reads it,
  and so do curl and most other tools.
- `cmake -DCMAKE_TLS_CAINFO=/path/to/ca.pem …`, or `set(CMAKE_TLS_CAINFO …)` in
  the project. This wins over `SSL_CERT_FILE`. `TLS_CAINFO` sets it for one
  `file(DOWNLOAD)` call.
- `CURL_CA_BUNDLE` is read by the `curl` command, not by CMake. Upstream CMake
  never reads it, and libcurl doesn't either. If you set only that and clear
  `SSL_CERT_FILE`, cmake trusts nothing.

Downloads through the kernel's proxy are always signed by the kernel CA. A
bundle that replaces it, rather than adding to it, makes those downloads fail
verification. `TLS_VERIFY OFF`, `-DCMAKE_TLS_VERIFY=OFF` or
`CMAKE_TLS_VERIFY=0` in the environment turns verification off.

## Licences

`LICENSE` is CMake's. `THIRD-PARTY-NOTICES.md` covers the Emscripten runtime,
the libraries CMake bundles that `cmake.wasm` links (libuv, libarchive, expat,
jsoncpp, zstd, bzip2, liblzma, librhash and llpkgc), curl and Mbed TLS from
wasm-curl, zlib from wasm-zlib, and homescoop's own slicc shims (Apache-2.0).

## Environment

`cmake.wasm` links `shims/slicc/slicc-env.js`: its environment is only what
the kernel passes, with none of Emscripten's placeholders (`USER=web_user`,
`HOME=/home/web_user`, `PATH=/`). After `env -i`, `cmake -E environment`
shows no `HOME`, `USER`, `LOGNAME`, `PATH` or `LANG`.

## Building

`build.sh` compiles CMake with emcmake from the patched emscripten 6.0.9 tree
(`scripts/emscripten-tree.sh`), with `-DCMAKE_USE_SYSTEM_CURL=ON`. That forces
`CMAKE_USE_SYSTEM_ZLIB` on, so libarchive uses wasm-zlib too. recipe.yaml pins
`@ai-ecoverse/wasm-curl@8.22.0-10` and `@ai-ecoverse/wasm-zlib@1.3.1-4` as host
dependencies, and host-run unpacks their `lib/` and `include/` into `PREFIX`.

Those archives are built with emsdk 4.0.23, not the 6.0.9 tree. They link
because they hold plain C objects for the same wasm32-emscripten libc. sizeof,
alignment and the field offsets of the structs libcurl passes across
(`stat`, `timeval`/`timespec`, `fd_set`, `pollfd`, `addrinfo`, the
`sockaddr_*`, `passwd`, `dirent`, `sigaction`/`sigset_t`, the `pthread_*`
types, `tm`, `ifaddrs`, `jmp_buf`) are the same in both toolchains.
libcurl's alarm-based resolver timeout uses Emscripten's JS setjmp/longjmp
(`invoke_*`, `__wasm_setjmp`), which is what cmake.wasm already links (it
uses `-fexceptions`, not Wasm exceptions). qpdf links wasm-zlib and
libjpeg-turbo from 4.0.23 into a 6.0.9-tree build the same way.

Mbed TLS's entropy source, `shims/slicc/webcrypto-entropy.c`, is compiled
with the tree into libslicc instead of using wasm-curl's prebuilt `.o`. The
build fails if `cmake.wasm` still links `Utilities/cmcurl`, `cmnghttp2` or
`cmzlib`.
