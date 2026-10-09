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
