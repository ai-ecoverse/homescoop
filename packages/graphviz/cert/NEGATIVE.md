# Negative proof (graphviz)

**Date:** 2026-11-17

## Empty wasm

`prove-negative.mjs --package graphviz` empties `bin/dot.wasm`; every case of
`cert/checklist.mjs` runs dot, so the first (`dot -V`) fails.

## Without the build's choices

The first local build, without `-fwasm-exceptions` and with `<sys/mman.h>`, linked and packed,
but dot did not start in the kernel (slicc-kernel 1.189.0, in local workerd through
helix-opspile's `npm run computer:dev`):

    dot: cannot start: the kernel's Emscripten runtime does not provide env.__cxa_throw, env._munmap_js

Every case fails on that build: `dot -V` exits 1 with that line on stderr.

## Without loadimage-unistd.patch

Without `<sys/mman.h>`, graphviz 16.1.1's `plugin/core/gvloadimage_core.c` calls `read(2)`
without `<unistd.h>`, and the build stops:

    gvloadimage_core.c:199:9: error: call to undeclared function 'read'; ISO C99 and later do not support implicit function declarations

The checklist's last case (a PostScript usershape in the `-Tps` output) runs that code.

## Wrong-output cases (in-spec)

The checklist asserts the layout itself, not only that dot exits 0: the node and edge counts of
the JSON and the SVG, left to right under `rankdir=LR`, every engine's `plain` output, and dot's
own messages for a syntax error and an unknown format.
