# Negative proof (wasix-openssh)

## 10.6.0-7: openbsd-compat ppoll, not the libc's (-8, homescoop#394)

`ppoll.mjs` against the published 10.6.0-7 (`cert/ci.sh`, local sshd + paramiko, 2026-10-16): FAIL on its first check, `ssh.wasm still carries the openbsd-compat ppoll`. The other lines pass the same way with -7, since its compat `ppoll` (`pselect` with the mask) behaves like -29's libc `ppoll`, so this is a toolchain refresh. The reason -7 needed the compat copy: -28's libc `ppoll` returned ENOSYS for the events-0 pollfds ssh passes for idle channels. Every session ended with `poll: Function not implemented` (#386). -29 accepts those entries, and 10.6.0-8 links it.

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

## 10.6.0-7: negative 10.6.0-6 (wasix-sysroot -22 → -28)

`marker.mjs` on published 10.6.0-6: every `bin/*.wasm` carries `slicc.libc` = `wasix-sysroot 2025.9.30-22`, under the new floor of 28. The -28 behaviour (ssh's ppoll with its unblocking signal mask, atomic through slicc-kernel ≥ 1.88.0) is exercised by `winsize.mjs` (SIGWINCH → window-change in `ssh -t`) and the PTY ^C row. The race it closes is the sysroot's r28w window case.

## 10.6.0-12: key comments and coverage (homescoop#1050, #1052; 2026-10-20)

- **#1050, `hostname.mjs`:** fails on the published 10.6.0-11. Its ssh-keygen writes `root@wasmer.sh` (the issue's repro, slicc-kernel 1.93.0 and 1.123.1), because wasix-sysroot -34's `gethostname()` answers Wasmer's built-in name. -12 is built on -39, where uname takes the node name from `HOSTNAME` and falls back to `slicc` (#1117).
- **#1052, `crypto.mjs`:** this is coverage, not a fix. It passes on 10.6.0-10 and -11 as well (the issue's report), and it guards the openssl, zlib and sysroot paths from here on.
