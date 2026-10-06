# wasm-nano 8.7.1-1

Emscripten + static `libncursesw` (fallbacks: xterm-256color,xterm,vt100,dumb).
Same curses ABI as wasm-less. Interactive — certify in the **browser** harness.

## Smoke (host, non-interactive)
```sh
SMOKE_WORKDIR=$TMP node scripts/run-wasm-cli.mjs packages/nano/package/bin/nano -- --version
```

## Browser acceptance
Open a file, edit, save (^O), exit (^X). TERM=xterm-256color.
