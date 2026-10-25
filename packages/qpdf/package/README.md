# `@ai-ecoverse/wasm-qpdf`

[qpdf](https://qpdf.sourceforge.io/) 12.4.2 for
[slicc](https://github.com/ai-ecoverse/slicc)'s wasm realm: `qpdf`,
`fix-qdf` and `zlib-flate`. It replaces slicc 6's `pdftk`.

```bash
pnpm add -g @ai-ecoverse/wasm-qpdf
qpdf --empty --pages a.pdf b.pdf -- merged.pdf    # pdftk cat
qpdf --split-pages in.pdf page-%d.pdf             # pdftk burst
qpdf --rotate=+90:1 in.pdf out.pdf                # pdftk rotate
qpdf --json in.pdf                                # pdftk dump_data
qpdf --password=secret --decrypt in.pdf out.pdf
qpdf --linearize in.pdf web.pdf
qpdf --check in.pdf
```

For text extraction use `pdftotext` from `@ai-ecoverse/wasm-poppler`.

Built with qpdf's native crypto provider (no OpenSSL or GnuTLS), and with
zlib and libjpeg-turbo from homescoop.

## 12.4.2-6: fix-qdf is a helper; no pkg-config at configure (homescoop#1354; 2026-10-20)

`fix-qdf` has `"helper": true` in `slicc.commands`, as the KC ruled. It still runs as before; listings that hide helpers leave it out. The description is now one plain sentence. The build configures with no pkg-config, so a zlib port in the emsdk cache can't replace `@ai-ecoverse/wasm-zlib`. The bytes are the same.

`qpdf.wasm` can still come out in one of two 14-byte variants. That comes from emsdk 4.0.23's LLVM: its WebAssembly CFG Stackify pass iterates a pointer-keyed map, and the nesting of one try/delegate pair varies. Both variants behave the same. The fix arrives with an emsdk at or after 6.0.2 (llvm-project#205184). See cert/NEGATIVE.md.


## 12.4.2-8: checked for reproducible builds (homescoop#1354, #808, #918; 2026-10-22)

homescoop's CI now builds qpdf twice and compares the two packages. The build stops unless `qpdf`, `fix-qdf` and `zlib-flate` link the zlib and libjpeg-turbo from homescoop, with no pkg-config module. New cert specs cover pages copied between files (`cert/foreign.mjs`) and the package's command list (`cert/manifest.mjs`). The tools behave as in 12.4.2-7.

## 12.4.2-9: reproducible qpdf.wasm (homescoop#1354; 2026-10-23)

qpdf now builds with the patched Emscripten 6.0.9 tree (`scripts/emscripten-tree.sh`, the toolchain cmake, wasm-binaryen and wasm-clang use) instead of emsdk 4.0.23. emsdk 4.0.23's LLVM nested one try/delegate pair in `qpdf.wasm` by heap address, so two builds of the same inputs could differ by 14 bytes. emsdk 6.0.9's LLVM has the fix (llvm-project fd76c9bdf103, in emsdk 6.0.2 and later), and every build now gives the same bytes. The tools behave as in 12.4.2-8: the same qpdf, the same zlib and libjpeg-turbo, the same slicc shims, and still Wasm exceptions in their legacy encoding. The Emscripten runtime in the glue is now 6.0.9, with the 4.0.23 build's `FS.lookupPath` symlink fix (wasm-emscripten's `0014-libfs-symloop.patch`) applied on top.

## 12.4.2-10: licence notices (homescoop#1750; 2026-10-23)

The package now ships qpdf's `NOTICE.md`, which 12.4.2-8 and 12.4.2-9 left out. It credits the SHA-2 code qpdf includes from sphlib 3.0 (Projet RNRT SAPHIR, MIT licence) and the public-domain Rijndael code. `THIRD-PARTY-NOTICES.md` now also carries the sphlib notice from `libqpdf/sha2.c` and the RSA Data Security MD5 notice from `libqpdf/MD5_native.cc`. The tools are unchanged.
