# wasi-rustc PRESTAGE

Must pass with SLICC-like env:

```
PATH=/usr/bin:/bin
HOME=/home
TMPDIR=/tmp
LD_LIBRARY_PATH=/lib
RUST_MIN_STACK=16777216
```

- `rustc --version`
- Caller PATH set; driver unsets it before launching rustc.wasm
- `rustc hello.rs -o hello.wasm` (driver supplies `--sysroot` + `--target`)
- `-O` + `std::fs` / `std::env` / `std::process::exit`
- tarball has no symlinks/hardlinks
- Prefer `bin/rustc.wasm` with a wasm **name** section (or ship `bin/rustc.wasm.debug`) for SLICC_WASM_BACKTRACE
