# Negative proof (nano)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`.

## Empty wasm

With `bin/nano.wasm` truncated to 0 bytes, the checklist fails at the first
`nano` (slicc-kernel 1.23.0, Node entry):

```
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## Known-bad build: no terminal fallbacks

`build.sh` with `--with-fallbacks=dumb` instead of
`xterm-256color,xterm,vt100,dumb` (built locally, not committed): nano
cannot open the kernel's `xterm-256color` terminal, and the checklist fails:

```
+ 'Error opening terminal: xterm-256color.\n'
- 'Standard input is not a terminal\n'
```

## Spec non-vacuous

Every pty case must reach its prompts (`[ New File ]`, `Write to File:`,
`[ Wrote 2 lines ]`, `Save modified buffer?`) and exit by itself. The saved
files are compared byte for byte, including UTF-8 text, and the discard
case checks that the file did not change.
