# `@ai-ecoverse/wasm-curl`

curl 8.22.0 and static libcurl for slicc's wasm realm. Mbed TLS backend
(honors `SSL_CERT_FILE` / `CURL_CA_BUNDLE`), zlib, HTTP/1.1 only. Linked
with slicc socket + select + spawn shims for loopback networking and the
upcoming HTTP CONNECT / TLS proxy (`http_proxy` / `https_proxy`).

```bash
pnpm add -g @ai-ecoverse/wasm-curl
curl http://127.0.0.1:8080/
```

Consumers (e.g. git) link `lib/libcurl.a` plus the shipped Mbed TLS
archives and `lib/webcrypto-entropy.o`; see `lib/pkgconfig/curl.pc`.

Names other than `localhost` and numeric IPv4 go to the kernel's resolver.
Tailnet names need slicc-kernel ≥ 1.27.0 plus a page uplink (seven's
Tailscale); then `curl --noproxy '*' http://peer.your-tailnet.ts.net/`
resolves and connects directly (IPv4 / A records only). Without them such
names fail with "Could not resolve", as before.

## 8.22.0-8: the environment is the kernel's

`curl -n` finds `~/.netrc` when `HOME` is unset, through the passwd entry's home, as on Linux (homescoop#724). Emscripten's glue used to fill a missing variable with its placeholders (`HOME=/home/web_user`, `USER=web_user`, `PATH=/`, …), so curl looked in `/home/web_user`. curl now links `slicc-env.js`, so it sees only the environment the kernel passes. `env -i curl …` gets no `PATH=/` either.

## 8.22.0-10: the shared slicc-env.js, and /etc/hosts

curl links `shims/slicc/slicc-env.js`, the copy every `homescoop_em_cli_ldflags` link gets, instead of the copy in `packages/coreutils` (homescoop#1625). The build fails if the glue still has Emscripten's `USER: "web_user"` placeholders. With `HOME` unset, curl finds `~/.curlrc` and `~/.netrc` through the passwd entry's home and never looks in `/home/web_user`. Under `env -i` it sees no `HOME`, `USER`, `LOGNAME`, `PATH`, `PWD` or `LANG`.

Names in `/etc/hosts` (IPv4 lines, any case, with or without a final dot) resolve before the kernel's resolver is asked, as with musl (homescoop#580). Commented lines and `::1`-only names don't resolve. Only root can edit the file.

curl is rebuilt and compared byte for byte in every ladder-pr (it's off `scripts/reproducible-pending.json`, #808).
