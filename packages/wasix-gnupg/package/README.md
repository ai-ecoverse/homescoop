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

## 2.4.9-12

- **Trustdb hand-off checks the name** (homescoop#1111). When root's gpg creates a `trustdb.gpg` in another user's homedir, it gives the file to the homedir's owner through the name itself: it reopens the name with `O_NOFOLLOW` and gives away that descriptor, and only if it's a regular file with one link. The keybox and lock-file paths already work this way. A `trustdb.gpg` that cone symlinks to a root file is never handed over. A `trustdb.gpg` that cone points at a root file stays root's.
- **`gpg-agent` is a helper command** (`"helper": true`). gpg starts it, so it's no longer listed as something you run.

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
  files stay in place. Since 2.4.9-10, root gives a lock file it creates in
  another user's directory to that directory's owner (only one it created
  itself, never a name that was already there), and a gpg that can't
  open a lock file for writing replaces it if no process holds it
  (homescoop#888). `gpgconf --lock`/`--unlock` aren't supported: an fcntl
  lock ends with its process, so no lock can outlive gpgconf, and both say
  so and fail (homescoop#881).
- Concurrent gpg runs in a fresh homedir (2.4.9-9, homescoop#712): gpg
  reads the keybox without a lock and takes an empty `pubring.kbx` for an
  old-style keyring. Up to 2.4.9-8 gpg created the keybox empty and wrote
  its header afterwards, so of six concurrent `gpg --import` runs into a
  new homedir some failed with `invalid packet (ctb=00)` and lost their
  key. 2.4.9-9 writes the new keybox to `pubring.kbx.tmp` and renames it
  into place, which is atomic for other processes from slicc-kernel
  1.117.2 (engines floor; ai-ecoverse/slicc-kernel#925). Updates already
  replace the keybox by a rename, and its backup (`pubring.kbx~`) is a
  copy, so the keybox name is always there. A keyring shorter than a
  keybox header is probed under its lock, unless the caller can write
  neither the lock file nor its directory (an empty keyring in a read-only
  directory, homescoop#955).
- Keybox updates (2.4.9-10, homescoop#966): on slicc-kernel's OPFS root a
  file created under a name that was just renamed away gets the renamed
  file's inode number (ai-ecoverse/slicc-kernel#954). Up to 2.4.9-9 every
  update was written to `pubring.kbx.tmp`, so all versions of the keybox
  shared one inode number, and a `gpg -k` running alongside imports
  sometimes failed with `keydb_search_next failed: Provided object is too
  short` (no key was lost). 2.4.9-10 writes each update to a tmp name of
  its own (`pubring.kbx.tmp.<pid>.<n>.<time>`) and removes it if the update
  fails. slicc-kernel 1.123.1 fixes #954 (ai-ecoverse/slicc-kernel#963).
  The unique names are kept for kernels < 1.123.1, from the engines floor
  (1.117.2) up.
- Root's gpg on someone else's homedir (2.4.9-11, homescoop#1031): a keybox
  or trustdb it creates there, a keybox it updates, and the update's backup
  `pubring.kbx~` belong to the directory's (or the replaced keybox's)
  owner, as its lock files do (homescoop#888). Before, an import as root left `pubring.kbx`
  root-owned and the owner's gpg found no writable keyring. Only a regular
  file with one link that this gpg created is given away. A backup that an
  older run left root-owned is replaced when the owner's gpg next updates
  the keybox.

## How it is built

`packages/wasix-gnupg/build.sh` in homescoop; the patches and upstream
tarball checksums ship in `patches/` and `SOURCES.md`.

- Spawns are `posix_spawn` (no fork); `gpg-agent --daemon` detaches by
  starting itself again.
- Built against wasix-sysroot 2025.9.30-34 (since 2.4.9-10; 2.4.9-7 to -9 used -31/-32, 2.4.9-6 used -28, earlier ones -20): signal
  masks are slicc-kernel's (≥ 1.88.0), so gpg-agent's `npth_pselect` with its
  signal mask waits and wakes atomically: SIGHUP re-reads the configuration
  and flushes the cache in place, SIGTERM shuts the agent down (it removes its
  socket and exits), SIGINT shuts it down at once. User ids come from slicc-kernel's
  process credentials, and on slicc-kernel ≥ 1.47.1 a file's owner is the
  caller's ids, so each user's own homedir passes GnuPG's ownership check
  (it refuses a homedir it does not own). Needs slicc-kernel ≥ 1.47.1.

License: GPL-3.0-or-later (GnuPG); the libraries' licenses are in
`licenses/`.
