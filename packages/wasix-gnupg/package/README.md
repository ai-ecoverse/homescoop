# `@ai-ecoverse/wasix-gnupg`

GnuPG 2.4 for the slicc wasm realm (WASIX): `gpg` (also `gpg2`), `gpgv`,
`gpg-agent`, `gpgconf` and `gpg-connect-agent`. libgpg-error, libgcrypt,
libassuan, libksba and npth are linked in statically.

```bash
gpg --batch --passphrase '' --quick-gen-key 'Me <me@example.com>' default default never
echo hi | gpg --clearsign | gpg --verify
git config --global gpg.program gpg && git commit -S -m signed
```

- **Keyring**: `~/.gnupg` (or `$GNUPGHOME`) on the VFS. On slicc-kernel
  ≥ 1.35.1 the files get their usual modes (homedir and
  `private-keys-v1.d` 700, keys and `trustdb.gpg` 600) and gpg's
  "unsafe permissions" check works; older kernels leave them 755/644.
- **gpg-agent** starts on first use, detached, and later commands reach it
  through `$GNUPGHOME/S.gpg-agent` on the realm's loopback namespace. It
  caches passphrases as usual (`default-cache-ttl`).
- **Passphrases**: there is no pinentry program. `gpg` defaults to
  `--pinentry-mode loopback` and asks on the terminal (`/dev/tty`), also
  when git runs it with its stdio piped. Without a terminal (the agent's
  `bash` tool), use unprotected keys or `--batch --passphrase-fd`.

## Not included

gpgsm (S/MIME), scdaemon (smartcards), dirmngr (keyservers, CRLs),
keyboxd, gpgtar, the WKS tools, TOFU (needs SQLite), compression
(`--disable-zip`: messages from other GnuPGs that are compressed do not
decrypt yet).

## Known limitations

- WASIX has no sessions or process groups (`setsid`/`setpgid`). A detached
  gpg-agent stays in the process group of the command that started it, so a
  ^C to that same foreground job also reaches the agent (it shuts down; the
  next gpg starts a new one).
- `gpg-agent --daemon PROGRAM` (run a program under the agent) needs fork
  and is not supported.
- Lock files (2.4.9-8, homescoop#712): gpg's dotlock holds an `fcntl` write
  lock on `<file>.lock` (`pubring.kbx.lock`, `trustdb.gpg.lock`), which
  slicc-kernel (≥ 1.100.0) enforces between processes and drops when the
  holder exits, so concurrent gpg runs on one homedir no longer lose keys
  and there are no stale locks to remove. Up to 2.4.9-7 dotlock fell back
  to an `O_EXCL` lock file (OPFS has no hard links), which raced: runs
  failed with "Oops, … is not locked" or "lockfile disappeared". The lock
  files stay in place. `gpgconf --lock`/`--unlock` still use the old lock
  file protocol and don't exclude a running gpg.
- Concurrent gpg runs in a fresh homedir (2.4.9-9, homescoop#712): gpg
  reads the keybox without a lock and takes an empty `pubring.kbx` for an
  old-style keyring. Up to 2.4.9-8 gpg created the keybox empty and wrote
  its header afterwards, so of six concurrent `gpg --import` runs into a
  new homedir some failed with `invalid packet (ctb=00)` and lost their
  key. 2.4.9-9 writes the new keybox to `pubring.kbx.tmp` and renames it
  into place, which is atomic for other processes from slicc-kernel
  1.117.2 (engines floor; ai-ecoverse/slicc-kernel#925). Updates already
  replace the keybox by a rename, and its backup (`pubring.kbx~`) is a
  copy, so the keybox name is always there.

## How it is built

`packages/wasix-gnupg/build.sh` in homescoop; the patches and upstream
tarball checksums ship in `patches/` and `SOURCES.md`.

- Spawns are `posix_spawn` (no fork); `gpg-agent --daemon` detaches by
  starting itself again.
- Built against wasix-sysroot 2025.9.30-28 (since 2.4.9-6; -20 before): signal
  masks are slicc-kernel's (≥ 1.88.0), so gpg-agent's `npth_pselect` with its
  signal mask waits and wakes atomically: SIGHUP re-reads the configuration
  and flushes the cache in place, SIGTERM shuts the agent down (it removes its
  socket and exits), SIGINT shuts it down at once. User ids come from slicc-kernel's
  process credentials, and on slicc-kernel ≥ 1.47.1 a file's owner is the
  caller's ids, so each user's own homedir passes GnuPG's ownership check
  (it refuses a homedir it does not own). Needs slicc-kernel ≥ 1.47.1.

License: GPL-3.0-or-later (GnuPG); the libraries' licenses are in
`licenses/`.
