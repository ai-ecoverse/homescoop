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
