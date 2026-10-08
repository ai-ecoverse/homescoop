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
