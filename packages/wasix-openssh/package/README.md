# `@ai-ecoverse/wasix-openssh`

[OpenSSH](https://www.openssh.com/) portable **10.6p1** client tools for the
[slicc](https://github.com/ai-ecoverse/slicc) WASIX realm: `ssh`, `ssh-keygen`,
`scp`, `sftp`, and `ssh-add`.

Built with the pinned wasixcc on **wasix-sysroot 2025.9.30-17**, linking
**wasix-openssl 3.5.9-3** and **wasix-zlib 1.3.1-2** via pkg-config only
(`-Wl,--fatal-warnings`). No `sshd` in this package.

```bash
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519
ssh -o StrictHostKeyChecking=accept-new user@host true
GIT_SSH_COMMAND=ssh git clone ssh://user@host/repo.git
```

## Identity and `~/.ssh`

OpenSSH resolves `~` with `$HOME` first, then `getpwuid`. The default remote
user name comes from `getpwuid` (wasix-sysroot `slicc_identity` → `user` /
`/home/user` on -17). Until H1 (sysroot **-19** + kernel K1), set `$HOME` and
`$USER` explicitly in the realm, and prefer `user@host` or `-l` when the
default user must match a real account. Key files need mode **0600** (kernel
≥ 1.35.1 `slicc_fs`).

## Interactive PTY (`ssh -t`)

`enter_raw_mode` clears `ISIG` / `IEXTEN` / `OPOST` through `tcsetattr`. WASIX
`tty_set` cannot clear those yet ([slicc-kernel#247](https://github.com/ai-ecoverse/slicc-kernel/issues/247)),
so a local **^C** can hit the local `ssh` instead of being forwarded. Use the
SSH escape **`~.`** (newline, tilde, period) to disconnect until #247 lands.
This package does **not** patch around that in OpenSSH.

## Auth

- `none` (for link servers that allow it)
- publickey: ed25519, ecdsa, rsa
- keyboard-interactive / password
- `~/.ssh/config`, `known_hosts` (`StrictHostKeyChecking`, `accept-new`)

## Fork / spawn

Outbound TCP uses kernel sockets (uplink-routed). Exec mode needs no fork.
ProxyCommand, ControlMaster, `-f`, and scp→ssh prefer `posix_spawn` /
homescoop exec shims where possible; true daemonize and double-fork paths are
unsupported — see build notes as they land.

## Sysroot

OpenSSH 10.6's client loop uses **poll/ppoll**, not select/pselect. Build
against **-17** now; move to **-18** when published (select/pselect fixes are
still useful for other code paths).

## Not in v1

`sshd`, PKCS#11, security keys, Kerberos, PAM, SELinux. Local forwarding
(`-L`/`-D`) and ProxyJump are nice-to-have follow-ups.

Recipe: [homescoop/packages/wasix-openssh](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-openssh).
