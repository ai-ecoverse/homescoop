# `@ai-ecoverse/wasm-screen`

GNU screen 5.0.1 for slicc's wasm realm (Emscripten ABI, Asyncify fork), on
slicc-kernel's pseudo-terminals.

```bash
pnpm add -g @ai-ecoverse/wasm-screen
screen -S work            # C-a d detaches
screen -ls                # lists sessions (sockets in SCREENDIR=/tmp/screens)
screen -r work            # reattach, from the same terminal (see below)
screen -dmS job make      # detached session; screen -S job -X quit ends it
```

Sockets live in `SCREENDIR=/tmp/screens` (set by the package); `screen -ls`
lists them.

## Known limits

- **Reattaching from a different terminal does not work yet.** `screen -r`,
  `-d -r` and `-x` from any terminal other than the one the session was
  started from return 0 without attaching; the session stays Detached and
  can be reattached from the original terminal. The server has to open the
  attaching terminal's device, and slicc-kernel (up to at least 1.30.0) hides
  other terminals' `/dev/ttyN` from a process
  ([slicc-kernel#192](https://github.com/ai-ecoverse/slicc-kernel/issues/192));
  screen's Linux route, passing the terminal over its socket with
  `SCM_RIGHTS`, is not available on the kernel's sockets. A remote
  `screen -d <session>` from another terminal does nothing for the same
  reason.
- `screen -Q windows` on a detached session prints nothing.
