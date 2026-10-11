# Negative proof (wasix-openssh)

## 10.6.0-5 (wasix-sysroot -18) against the 10.6.0-6 cert

`node packages/wasix-openssh/cert/run.mjs --tarball ai-ecoverse-wasix-openssh-10.6.0-5.tgz`
on slicc-kernel 1.51.0, 2026-10-11 (10.6.0-6 passes all four specs on the same host):

- `checklist.mjs` FAIL: `ssh -G` says `user user`, `~` is not root's `/root` (-18's
  libc faked uid 1000 `user` with `/home/user`; the cert used to fake `HOME` to match).
- `marker.mjs` FAIL: `scp.wasm: slicc.libc undefined` (no libc generation marker before -22).
- `users.mjs` FAIL: as root, `ssh -G` reports `user user`.
- `winsize.mjs` FAIL: `Host key verification failed` before the first prompt (the
  wrong `~` hides root's `known_hosts`/config).

Also: with wasm-git 2.55.0-13 (before the credential shims) `git -C <clone> log`
exits 128 on a root-owned clone (git sees uid 1000 vs owner 0); the cert uses
wasm-git 2.55.0-15 and wasm-bash 5.3.0-13.

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
