# Sources

bin/m4.wasm is GNU m4 1.4.20, built from the upstream tarball with `patches/` applied:

| file | sha256 |
| --- | --- |
| [m4-1.4.20.tar.xz](https://mirrors.kernel.org/gnu/m4/m4-1.4.20.tar.xz) | `e236ea3a1ccf5f6c270b1c4bb60726f371fa49459a8eaaebc90b216b328daf2b` |
| patches/getlocalename-wasix.patch | in this package |

It links wasix-libc from @ai-ecoverse/wasix-sysroot (THIRD-PARTY-NOTICES.md).

Build recipe: https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-m4
