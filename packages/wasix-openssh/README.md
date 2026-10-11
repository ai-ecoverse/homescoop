# `@ai-ecoverse/wasix-openssh`

[OpenSSH](https://www.openssh.com/) portable **10.6p1** client tools for the
[slicc](https://github.com/ai-ecoverse/slicc) WASIX realm: `ssh`, `ssh-keygen`,
`scp`, `sftp`, and `ssh-add`.

Built with the pinned wasixcc on **wasix-sysroot 2025.9.30-22** (since
10.6.0-6; -5 was on -18), linking
**wasix-openssl 3.5.9-3** and **wasix-zlib 1.3.1-2** via pkg-config only
(`-Wl,--fatal-warnings`). No `sshd` in this package.

```bash
ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519
ssh -o StrictHostKeyChecking=accept-new user@host true
GIT_SSH_COMMAND=ssh git clone ssh://user@host/repo.git
```

## Identity and `~/.ssh`

Since 10.6.0-6 the user is the kernel's (wasix-sysroot -20 credentials,
slicc-kernel ≥ 1.44.0): the default remote user and `~` come from the
kernel's passwd, `root` with `/root`, or an added user with its own home, and
files ssh writes (keys, `known_hosts`) belong to that user. Key files need
mode **0600**; a private key readable by others is refused (`UNPROTECTED
PRIVATE KEY FILE`).

## Interactive PTY (`ssh -t`)

Since 10.6.0-6 (wasix-sysroot -21 per-descriptor termios, slicc-kernel ≥
1.48.0) `enter_raw_mode` really clears `ISIG` / `IEXTEN` / `OPOST`, so a
local **^C** reaches the remote, and resizing the local terminal reaches the
remote pty (SIGWINCH → window-change). With -5, or on older kernels, ^C hit
the local `ssh` ([slicc-kernel#247](https://github.com/ai-ecoverse/slicc-kernel/issues/247)).


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
`0002-wasix-scp-sftp-posix-spawn.patch`) over a `socketpair`, building each
call's argv on a **copy** of the option list so multi-source / `-3` stay
correct. They need a kernel with working `sock_pair`
(`engines.slicc-kernel` **≥ 1.41.0**; cert pin **1.41.3**).

**Unsupported (still `fork` in upstream OpenSSH):** `ProxyCommand`,
`ProxyJump` (`-J`), and `SSH_ASKPASS` / `ssh-askpass`. They fail with
`fork failed: Function not implemented`. Use a direct route or inject keys
with `-i` / `IdentityFile` instead. ControlMaster / `-f` / true daemonize
are likewise unsupported.

`set_sock_tos` ignores `ENOSYS` / `EOPNOTSUPP` / `ENOPROTOOPT` so missing
`IP_TOS` does not pollute stderr (patch `0003`). `ssh-keygen -R` / `-H`
backs up `known_hosts` with a copy when `link()` is unavailable (patch
`0004`).

## Sysroot

**wasix-sysroot 2025.9.30-22**: select/pselect timeouts and socketpair
flags (-18), signals and EINTR (-19), the kernel's users (-20), per-fd
terminals (-21), and the `slicc.libc` marker in every binary (-22), so
slicc-kernel gives it EINTR semantics. OpenSSH 10.6's client loop uses
**poll/ppoll**.

## Not in v1

`sshd`, PKCS#11, security keys, Kerberos, PAM, SELinux. `ProxyCommand` /
`ProxyJump` / `SSH_ASKPASS` (see above).

Recipe: [homescoop/packages/wasix-openssh](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-openssh).
