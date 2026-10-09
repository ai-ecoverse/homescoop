# Negative proof (bash)

**Date:** 2026-10-10
Patches: see `cert/meta.json`. Not in `scripts/ci-certified.json`.

## /dev/tcp: the fork-profile build (5.3.0-9 as first built, and 5.3.0-8)

bash linked the `fork` shim profile, which has no `slicc_socket.c`, so
connect() and getaddrinfo were Emscripten's (WebSocket SOCKFS). `cert/net.mjs`
fails at the first case (slicc-kernel 1.30.0, Node entry):

```
proxy round trip rc=1 stderr=bash: connect: Host is unreachable
```

Every target fails the same way: 127.0.0.1, `$(hostname)`, the refused
port, an unknown name and the tailnet name. With the `netfork` profile they
give the round trip, "Connection refused" and "Name does not resolve".

## exec keeps the pid (slicc-kernel#99/#176)

bash 5.3.0-7 (spawn + `execWait` shim) fails `cert/checklist.mjs` at the
first exec case (`exec bash: $$/$PPID 1002 1001 != 1001 1`). The shim-only
proof on 1.26.6 is `shims/slicc/test/exec.test.mjs`.
