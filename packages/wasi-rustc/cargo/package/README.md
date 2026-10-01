# @ai-ecoverse/wasi-cargo

Offline Cargo 0.84 prototype for SLICC's WASI realm. It uses the installed
`@ai-ecoverse/wasi-rustc` driver, targets `wasm32-wasip1`, and supports
`cargo build --offline` of workspaces with path dependencies. Registry fetching
and Git dependencies are not yet enabled.
