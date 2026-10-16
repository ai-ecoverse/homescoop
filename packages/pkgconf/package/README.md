# `@ai-ecoverse/wasm-pkgconf`

[pkgconf](https://github.com/pkgconf/pkgconf) 3.0.9 for slicc's wasm realm,
as `pkgconf` and `pkg-config`.

```bash
pnpm add -g @ai-ecoverse/wasm-pkgconf
PKG_CONFIG_PATH=/usr/local/lib/pkgconfig pkg-config --cflags --libs zlib
```

## Coming from pkgconf 2.x

`--cflags`, `--libs`, `--static`, `--modversion`, `--exists` (with version
constraints), `--variable` and `--define-variable` print what they did in
2.5.1 for ordinary `.pc` files. What changed since pkgconf 3.0:

- `--variable=NAME a b` prints the value for every module, space-separated,
  not only for the first.
- `PKG_CONFIG_<MODULE>_<VARIABLE>` in the environment (`PKG_CONFIG_ZLIB_PREFIX`)
  overrides that variable of that module.
- `Conflicts:` between the modules of one `--cflags`/`--libs`/`--exists`
  query fail it (`PKG_CONFIG_IGNORE_CONFLICTS` skips the check).
- `${pc_sysrootdir}` is empty, not `/`, when no sysroot is set.
- `--list-all` and `--list-package-names` include the built-in `pkg-config`
  and `pkgconf` packages; `--print-variables` lists in file order.
- New: `--newlines`, and the `Requires.shared`, `Cflags.shared`, `Libs.shared`,
  `Link.ABI`, `Source` and `License.file` fields.

See [NEWS](https://github.com/pkgconf/pkgconf/blob/master/NEWS).
