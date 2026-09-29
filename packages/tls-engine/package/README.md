# @ai-ecoverse/wasm-tls-engine

The server side of TLS for [SLICC](https://github.com/ai-ecoverse/slicc)'s
wasm-realm HTTP proxy (ai-ecoverse/slicc#3571): Mbed TLS 3.6.5 sessions over
memory buffers, compiled with Emscripten to an ES module factory plus
`slicc-tls-engine.wasm`.

- The engine holds **no CA key**. `tls_leaf_new` generates a P-256 key pair
  and `tls_leaf_spki` hands out only its public key; the caller builds and
  signs the leaf certificate and gives the chain back (`tls_leaf_add_cert`).
- One session per CONNECT tunnel (`tls_session_new(leaf, host)`); a client
  SNI must name `host`. ALPN offers `http/1.1` only. TLS 1.2 and 1.3.
- Pull-shaped I/O: `tls_feed` ciphertext in, `tls_read` plaintext out
  (0 = needs more), `tls_write` plaintext in, drain `tls_out_take`.
- Entropy: `crypto.getRandomValues`.
- Built for pages and workers only (`-sENVIRONMENT=web,worker`: no Node
  branch, whose `import('module')` would land in a bundler's eager graph).
  In Node, pass the module's bytes: `createTlsEngine({ wasmBinary })`.

Types: `index.d.ts`. Build: `packages/tls-engine/build.sh` in homescoop.
