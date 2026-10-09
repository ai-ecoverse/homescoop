# `@ai-ecoverse/wasm-poppler`

[poppler](https://poppler.freedesktop.org/) 26.10.0 utilities for
[slicc](https://github.com/ai-ecoverse/slicc)'s wasm realm, all in one
multi-call wasm: `pdftotext`, `pdftoppm`, `pdfinfo`, `pdfimages`,
`pdffonts`, `pdfseparate`, `pdfunite`, `pdfdetach`, `pdfattach`, `pdftops`
and `pdftohtml`.

```bash
pnpm add -g @ai-ecoverse/wasm-poppler
pdftotext doc.pdf -               # text to stdout
pdftotext -layout doc.pdf out.txt
pdftoppm -png -r 150 doc.pdf page # page-1.png, page-2.png, …
pdftoppm -png -f 2 -l 3 doc.pdf p
pdfinfo doc.pdf
pdftotext -upw secret locked.pdf -
```

Rendering uses the Splash backend. Cairo is not built, so `pdftocairo` is
an alias of `pdftoppm`, as it was in slicc 6: `-png`/`-jpeg` work, but
`-svg`, `-pdf`, `-ps` and `-eps` do not; it says so and exits 99 (use
`pdftops` for PostScript).

There is no fontconfig. The 14 standard PDF fonts (Helvetica, Times,
Courier, Symbol, ZapfDingbats) are the URW Type1 fonts from
[gsfonts](https://packages.debian.org/source/sid/gsfonts) (GPL with a font
exception, see `share/fonts/COPYING`), found through `POPPLER_FONTSDIR`.
Embedded fonts render as they are, and other non-embedded fonts fall back
to the closest standard font. CJK text needs poppler-data, which is not
included.
