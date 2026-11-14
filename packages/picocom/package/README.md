# `@ai-ecoverse/wasm-picocom`

picocom 2024-07 for slicc (Emscripten ABI): a minimal terminal for the serial
ports the page grants, which slicc-kernel shows as `/dev/ttyUSB<n>` and
`/dev/ttyACM<n>` (slicc-kernel's "Embedder devices", 1.186.0 or later).

```bash
pnpm add -g @ai-ecoverse/wasm-picocom
sudo picocom -b 115200 /dev/ttyUSB0      # C-a C-x exits, C-a C-q quits without resetting the port
picocom --help
```

## Permissions

The nodes are `root:dialout 0640`, as on Linux: a `dialout` member may read
one, and opening it for writing, which picocom always does, needs root. So
run it with `sudo`. Without it picocom stops at once:

```text
FATAL: cannot open /dev/ttyUSB0: Permission denied
```

A node has one open file description at a time, so a second picocom (or
`screen`, or pyserial) on the same port gets `Resource busy` (EBUSY).

## What is built in

picocom's own build flags, no patches:

- Speeds are the standard ones, `50` to `4000000` (`HIGH_BAUD`). Custom
  speeds (`-b 250000`) are refused as on a picocom built without
  `USE_CUSTOM_BAUD`.
- DTR and RTS (`C-a C-t`, `C-a C-g`, `--lower-dtr` and the rest) go through
  `TIOCMBIS`/`TIOCMBIC`, and `C-a C-v` reads the lines with `TIOCMGET`.
- No file transfer: picocom is built with `NO_FORK`, so `C-a C-s` and
  `C-a C-r` do nothing and `--send-cmd`/`--receive-cmd` are refused
  (`Calling external programs is disabled`).
- picocom's `select()` is the shims' `pselect` (`em-select.c`), which
  waits in the kernel for the terminal or the port.
- No lock files (`/var/lock`) and no `flock`: the kernel already keeps a
  node exclusive.

## 2024.7.0-1

The first release: picocom 2024-07, the latest upstream release, from
[gitlab.com/wsakernel/picocom](https://gitlab.com/wsakernel/picocom).
