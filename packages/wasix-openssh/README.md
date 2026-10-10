# `@ai-ecoverse/wasix-openssh`

[OpenSSH](https://www.openssh.com/) portable **10.6p1** client tools for the
[slicc](https://github.com/ai-ecoverse/slicc) WASIX realm: `ssh`, `ssh-keygen`,
`scp`, `sftp`, and `ssh-add`.

Built with the pinned wasixcc on **wasix-sysroot 2025.9.30-18**, linking
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
so a local **^C** can hit the local `ssh` instead of being forwarded. The
host-node cert asserts that current behaviour (local `ssh` exits with a
SIGINT-ish status). Use the SSH escape **`~.`** (newline, tilde, period) to
disconnect until #247 lands. This package does **not** patch around that in
OpenSSH.

## `ssh-add` / agent

This package ships **`ssh-add`** but **not `ssh-agent`**. Without an agent
(`SSH_AUTH_SOCK` unset or dead), `ssh-add -l` exits **2** with
`Could not open a connection to your authentication agent.` Use keys via
`-i` / `IdentityFile`, or run an agent from another package/host if you need
one.

## Auth

- `none` (for link servers that allow it)
- publickey: ed25519, ecdsa, rsa
- keyboard-interactive / password
- `~/.ssh/config`, `known_hosts` (`StrictHostKeyChecking`, `accept-new`)

## Fork / spawn

Outbound TCP uses kernel sockets (uplink-routed). Exec mode needs no fork.
`scp` / `sftp` spawn the `ssh` helper with **`posix_spawnp`** (patch
`0002-wasix-scp-sftp-posix-spawn.patch`) over a `socketpair`; they need a
kernel with working `sock_pair` (`engines.slicc-kernel` **≥ 1.41.0**; cert
pin **1.41.3**). ProxyCommand, ControlMaster, and `-f` still prefer spawn
over fork; true daemonize and double-fork paths are unsupported.

## Sysroot

**wasix-sysroot 2025.9.30-18** (select/pselect sub-second timeouts and
socketpair flags; slicc_fs modes from -17). OpenSSH 10.6's client loop uses
**poll/ppoll**.

## Not in v1

`sshd`, PKCS#11, security keys, Kerberos, PAM, SELinux. Local forwarding
(`-L`/`-D`) and ProxyJump are nice-to-have follow-ups.

Recipe: [homescoop/packages/wasix-openssh](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-openssh).
