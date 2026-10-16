# Negative proof (wasi-protoc-gen-go cert/, homescoop#488)

**Date:** 2026-10-16, slicc-kernel 1.94.0, users enforce. No patches: the plugin is built from upstream as it is.

- **Empty wasm:** `prove-negative.mjs --package wasi-protoc-gen-go` on the published tarball: `cert failed on bad wasi-protoc-gen-go tarball` (`WebAssembly.compile(): BufferSource argument is empty`, at `protoc-gen-go --version`).
- **Wrong output:** `buf generate`'s files are compared byte for byte with `test/fixtures/golden`, native protoc-gen-go's output. Any difference fails the spec, naming the file.
- **Non-zero exit:** a `local:` plugin that isn't installed must make `buf generate` exit 1 with `executable file not found in $PATH`.
