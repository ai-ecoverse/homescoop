# Negative: wasm-imagemagick 7.1.2-32-3

7.1.2-32-3 fails `checklist.mjs` at its first assertion: `magick -version` lists only `jng jp2 jpeg lcms png tiff` as built-in delegates, with no freetype, webp, xml or zlib. The `.pc` files that `homescoop_ensure_prefix_pcs` synthesized for wasm-zlib, wasm-libwebp and wasm-freetype said `Version: 0`, so configure's `libwebp >= 0.4.1` and `freetype2 >= 2.8.0` checks failed, and -2/-3 configured `--without-xml`.

## Resource policy (7.1.2-33-1)

`policy.mjs` against the published `@ai-ecoverse/wasm-imagemagick` 7.1.2-32-4, which ships upstream's open policy, fails at its
first check, before any large allocation (slicc-kernel 1.81.0, 2026-10-14):

```
browser-cert: FAIL packages/zzneg/cert/policy.mjs
AssertionError [ERR_ASSERTION]: default limits: Resource limits:
  Width: 8.38861MP
+   '8.38861MP',
+   '8.38861MP',
+   '8.58993GP',
+   '2GiB',
```

With that policy `magick -size 30000x30000 xc:white` would start allocating
a 900 MP pixel cache, which is what hung the tab. On 7.1.2-33-1 the same spec
refuses it in about 60 ms and the 81 MP canvas in about 50 ms.
