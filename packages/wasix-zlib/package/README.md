# @ai-ecoverse/wasix-zlib

[zlib](https://zlib.net) 1.4 for [slicc](https://github.com/ai-ecoverse/slicc)
WASIX programs, built with the pinned wasixcc on wasix-sysroot 2025.9.30-34.
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

The build applies upstream's configure edits for `unistd.h` and `stdarg.h`
to `zconf.h` before compiling either flavour, then ships that same header.
Since 1.3.2 those conditions use `#if HAVE_*_H-0`; the build requires both
configured sections. The cert reads the expected runtime version from the
recipe, so a previously published library with an older upstream version
fails the current spec. A local assertion check accepts 1.4 probe output
and rejects the previous release's output; CI runs the actual linked probes.
