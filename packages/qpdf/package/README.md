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
