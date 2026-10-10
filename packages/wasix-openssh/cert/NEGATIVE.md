# Negative proof (wasix-openssh)

Recorded against known-bad builds once the host-node harness (`cert/run.mjs`)
is green on a good tarball.

## Planned cases

1. **Empty wasm** — `prove-negative.mjs` / zero-byte `bin/ssh.wasm` → kernel run
   fails before any dial.
2. **No uplink** — host sshd listening but kernel uplink unset → resolve/dial
   failure, non-zero `ssh`.
3. **known_hosts mismatch** — after `accept-new`, replace host key → `ssh`
   refuses (non-zero), no session.
4. **PTY ^C (kernel#247)** — on a good build this is the *documented* broken
   behaviour (local INTR), not a packaging regression. Re-record when
   slicc-kernel clears ISIG via `tty_set`.

Fill in commands and logs after the first passing CI/host-node run.
