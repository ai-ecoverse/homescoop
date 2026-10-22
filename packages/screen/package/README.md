# `@ai-ecoverse/wasm-screen`

GNU screen 5.0.1 for slicc's wasm realm (Emscripten ABI, Asyncify fork), on
slicc-kernel's pseudo-terminals.

```bash
pnpm add -g @ai-ecoverse/wasm-screen
screen -S work            # C-a d detaches
screen -ls                # lists your sessions (sockets in ~/.screen)
screen -r work            # reattach, from any terminal
screen -dmS job make      # detached session; screen -S job -X quit ends it
```

Each user's sockets live in `~/.screen` (mode 700; `$SCREENDIR` overrides
it), so one user's `screen -ls`, `-r` or `-x` never sees another's sessions.
Since 5.0.1-10 screen also knows who it runs as (slicc-kernel's process
credentials), as root or as any user. Up to 5.0.1-9 the package set
`SCREENDIR=/tmp/screens` for everyone and screen saw Emscripten's fixed ids:
the first user to start a session owned `/tmp/screens`, and every other
user's `screen -dmS` then failed silently.

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
- `screen -Q windows` on a detached session prints nothing. Upstream 5.0.1
  does the same natively: with no display, `ShowWindows(-1)` has no current
  window to list from (homescoop#662). Pass a format instead:
  `screen -Q windows '%n %t'`.

## 5.0.1-14 (homescoop#1149, #662; 2026-10-20)

`package.json` no longer sets `publishConfig.tag: next`, which disagreed with the `latest` channel it's published to. The description is one plain sentence. `cert/query.mjs` pins the `-Q windows` behaviour above.

## 5.0.1-15 (homescoop#1491; 2026-10-21)

A packaging bump for the updated `shims/slicc` (posix_spawn errno, `/etc/hosts` first, kernel-only environment, node name). screen's own code is unchanged.

## 5.0.1-16 (homescoop#1600, #1485; 2026-10-22)

This README is the only one: the recipe-root copy that build.sh used to copy over it is gone, and build.sh fails if one comes back. `cert/docs.mjs` checks that the tarball ships this file. `cert/stuff-log.mjs` drives a window from outside with `-X stuff`, `-X hardcopy` and `-L -Logfile`.
