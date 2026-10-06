# `@ai-ecoverse/wasm-libiconv`

GNU **libiconv 1.18** for WebAssembly / emscripten. Provides `iconv.h` and
`libiconv.a` so libxml2 can build `--with-iconv` against PREFIX (Shift-JIS,
EUC-JP, Windows-125x, ISO-8859-x, UTF-16/32).

Do not depend on an uncertified tarball.

## Contents

- `lib/libiconv.a` (and `libcharset.a` when installed)
- `include/iconv.h`

## Versioning

npm `1.18.0-1` is packaging rev 1 of upstream 1.18.
