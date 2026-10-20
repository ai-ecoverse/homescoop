# `@ai-ecoverse/py-fonttools`

fonttools for slicc WASIX CPython 3.15 (pure-Python). Since the Python 3.15 flip (homescoop#761) this is `latest`; the cp314 builds stay on npm by exact version ([release notes](https://github.com/ai-ecoverse/homescoop/blob/main/docs/release-notes/python-3.15.md)).

## Known limitations

- **No WOFF2** (homescoop#883): fontTools' WOFF2 encoder and decoder need the `brotli` extension module, which homescoop doesn't ship. `TTFont.flavor = "woff2"` saves and `pyftsubset --flavor=woff2` fail with an `ImportError` that names Brotli. TTF, OTF/CFF, WOFF (zlib), subsetting and TTX work.
