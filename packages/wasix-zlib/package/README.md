# @ai-ecoverse/wasix-zlib

[zlib](https://zlib.net) 1.3.1 for [slicc](https://github.com/ai-ecoverse/slicc)
WASIX programs, built with the pinned wasixcc on wasix-sysroot 2025.9.30-17.
A build-time package: no commands.

| directory | for |
| --- | --- |
| `lib/libz.a` | static-main programs (non-PIC), e.g. on the asyncify sysroot |
| `lib-pic/libz.a` | dynamic-main programs and side modules (`-fPIC`) |
| `include/` | `zlib.h`, `zconf.h` |
| `lib/pkgconfig/zlib.pc`, `lib-pic/pkgconfig/zlib.pc` | pkg-config, relative to the package |

```sh
PKG_CONFIG_PATH=node_modules/@ai-ecoverse/wasix-zlib/lib/pkgconfig \
  wasixcc app.c $(pkg-config --cflags --libs zlib)
```

Recipe: [homescoop/packages/wasix-zlib](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-zlib).
