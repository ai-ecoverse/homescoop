# @ai-ecoverse/wasi-rustc-names

The function names of `@ai-ecoverse/wasi-rustc`'s `bin/rustc.wasm`: the
payload of its wasm `name` section, which the compiler package ships without
(49.6 MB less to download and load).

Install it next to wasi-rustc of the same version only to read a compiler
trap: with `SLICC_WASM_BACKTRACE=1`, SLICC names the `wasm-function[N]`
frames from `bin/rustc.wasm.names`. Without it, frames stay unnamed and
nothing else changes. It contains data only, no commands.
