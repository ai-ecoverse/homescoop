# `@ai-ecoverse/wasm-screen`

GNU screen 5.0.1 for slicc's wasm realm (Emscripten ABI, Asyncify fork), on
slicc-kernel's pseudo-terminals.

```bash
pnpm add -g @ai-ecoverse/wasm-screen
screen -S work            # C-a d detaches
screen -ls                # lists sessions (sockets in SCREENDIR=/tmp/screens)
screen -r work            # reattach, from any terminal
screen -dmS job make      # detached session; screen -S job -X quit ends it
```

Sockets live in `SCREENDIR=/tmp/screens` (set by the package); `screen -ls`
lists them.

## Known limits

- **Reattaching from another terminal needs slicc-kernel ≥ 1.35.1.**
  The server opens the attaching terminal's device by path (screen's Linux
  route, passing the terminal over its socket with `SCM_RIGHTS`, is not
  available on the kernel's sockets), and older kernels hide other
  terminals' `/dev/ttyN` ([slicc-kernel#192](https://github.com/ai-ecoverse/slicc-kernel/issues/192)).
  On 1.35.1 `screen -r`, `-d -r` and `-x` attach from any terminal; on
  older kernels they return 0 without attaching, and the session stays
  Detached for its original terminal.
- A remote `screen -d <session>` does not detach a session that is attached
  in another terminal.
- `screen -Q windows` on a detached session prints nothing.
