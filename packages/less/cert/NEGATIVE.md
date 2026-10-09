# Negative proof (less)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`.

## Empty wasm

With `bin/less.wasm` truncated to 0 bytes, the checklist fails at the first
`less` (slicc-kernel 1.23.0, Node entry; certified on 1.26.6):

```
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## Known-bad build: no terminal fallbacks

`build.sh` with `--with-fallbacks=dumb` instead of
`xterm-256color,xterm,vt100,dumb` (built locally, not committed): ncurses
then has no terminfo for the kernel's `TERM=xterm-256color`, and the first
pty case fails (slicc-kernel 1.23.0, Node entry; certified on 1.26.6):

```
-F -X status=null out="WARNING: terminal is not fully functional\r\nPress RETURN to continue "
```

## Spec non-vacuous

The pty cases compare the rendered text (escape sequences stripped) and the
exact `-N`, `-S` and highlight sequences. Each must exit by itself (`-F`),
or on `q` after the expected prompt; a hang is reported as `status=null`
with the output so far. Secure mode is asserted through the refusal
message, not by its absence.
