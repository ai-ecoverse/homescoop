# @ai-ecoverse/wasi-zig-libc-src

The C sources of Zig 0.16.0's wasi-libc (lib/libc/wasi and lib/libc/musl), for
@ai-ecoverse/wasi-zig in slicc. Install it next to wasi-zig, at the same
version, to link libc for a wasm32-wasi CPU or mode other than the baseline
(for example `-mcpu=generic+simd128`, threads or PIC). The baseline target
needs nothing from here: wasi-zig ships its libc prebuilt.

    ipk install @ai-ecoverse/wasi-zig-libc-src

Licenses: wasi-libc is MIT / Apache-2.0 / Apache-2.0 WITH LLVM-exception
(lib/libc/wasi/LICENSE*); musl is MIT (lib/libc/musl/COPYRIGHT); Zig is MIT
(LICENSE).
