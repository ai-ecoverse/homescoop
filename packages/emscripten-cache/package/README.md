# @ai-ecoverse/emscripten-cache

Prebuilt Emscripten **sysroot** (headers + libs) for SLICC's `emcc`.

## Layout

- `sysroot/` — read-only package content (~99MB)
- `stamps/sysroot_install.stamp` — copied into the writable user `EM_CACHE` by
  `em-ensure-cache` so emcc never reinstalls headers through the sysroot symlink

## Runtime CACHE (not this package)

`@ai-ecoverse/wasm-emscripten` sets `EM_CACHE` to a **writable user dir**
(default `$XDG_CACHE_HOME/emscripten` or `~/.cache/emscripten`) and makes
`$EM_CACHE/sysroot` a **symlink** into this package. That means:

- No 100MB copy on install or first use
- `js_output/` and `symbol_lists/` warm in the user dir (survive `ipk` reinstall)
- Reinstall refreshes the symlink target; user warm state is kept

Do not set `CACHE` to this package directory.
