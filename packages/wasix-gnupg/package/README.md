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

## 2.4.9-16

- **Root's refusal of a symlinked keybox says why** (homescoop#1674). Since 2.4.9-15, root's gpg follows a symlinked keybox, keyring or trustdb only in a directory that root owns and that neither its group nor others can write. Elsewhere it refused with `Symbolic link loop`, which read like a filesystem bug. It now says which file it refused, why, and what to do, once per file and run, and the error that follows is `Operation not permitted`:

  ```text
  gpg: refusing to open '/tmp/gw/pubring.kbx' as root: it is a symbolic link, and its directory '/tmp/gw' is group-writable (gid 0), so another user could have put it there; make the directory writable only by root (chmod go-w '/tmp/gw') or use a regular file with one link
  ```

  In a directory root doesn't own, the hint is to use a regular file, or keep the link in a directory only root can write. A file with more than one hard link, or one that changes while gpg opens it, is refused the same way.
- **The refusal itself stays.** A group-writable homedir lets any member of its group remove root's link and put their own in its place, and root's gpg can't tell the two apart when it opens the file. The cert shows what that leads to on 2.4.9-14: a user who joined the `root` group after root made a setgid `root:root` 2775 directory, and a member of `users` in a `root:users` 2775 one, each symlinked `pubring.kbx` to a keybox only root can read, root imported a key there, and the user then read root's keys from the 644 `pubring.kbx` and `pubring.kbx~` it wrote. "The group has only root" is no exception either: group members can be added at any time (slicc-kernel's `groups.addMember`, or `users.add` with `groups`), and setgid only sets the group of new files, not who may write. So keep root's homedirs `chmod 700` (or at least `go-w`), or use regular files there.
- **More cert rows** (homescoop#1424): a homedir whose default legacy `pubring.gpg` (no `pubring.kbx`) a user symlinks to root's 600 keyring: after root's import there, nothing the user can read holds root's key and root's keyring is byte-identical.

## 2.4.9-15

- **Root's gpg no longer reads a keybox, keyring or trustdb through a user's symlink** (homescoop#1654). 2.4.9-14 refused to write through a planted name, but it still read through one: when root's gpg ran on another user's homedir whose `pubring.kbx` was a symlink to a file only root could read, it read that file, and the copy it makes for the backup (`pubring.kbx~`) and the updated keybox were the user's files afterwards, so the user could read root's keybox. The same held for a `gnupg-ring:` keyring. Now every read open of a keybox, a keyring and a trustdb goes through the same check as the in-place edits: for root, the name must be a regular file with one link, checked with `fstatat(AT_SYMLINK_NOFOLLOW)` on the directory's descriptor and opened with `openat(O_NOFOLLOW)` as that same `st_dev`/`st_ino`. That covers the keybox's read opens (searches, listings, the source of every update), the source of the backup copy, the probe that tells a keybox from a keyring, a keyring's read opens and the read-only trustdb. A symlinked keybox or keyring in a user's directory makes root's gpg fail (`Too many levels of symbolic links`) and leaves the symlink and its target as they are; up to 2.4.9-14 it replaced the symlink with a copy that the user owned. In a directory that root owns and only root can write, root's own symlinks are followed as before, and other users' gpg follows links as before.
- **More cert rows** (homescoop#1424): root's in-place edits (`--delete-secret-and-public-key`, `--import-ownertrust`) on a user's regular keybox and trustdb, root's own symlinked keybox and trustdb in its 700 directory, a `private-keys-v1.d` and a `pubring.kbx.lock` that a user symlinks into a root directory, and an update that keeps the owner of the regular keybox it replaces.

## 2.4.9-14

- **Root's gpg never writes through a symlink a user planted** (homescoop#1607). When root's gpg updated another user's keybox, it wrote the backup `pubring.kbx~` with `fopen("wb")`, and when it created a keybox it wrote `pubring.kbx.tmp` the same way. Both follow a symlink, so a user who pointed either name at a root file got root to overwrite it with a keybox (and 2.4.9-12 also handed it to that user). Now the backup, the temporary file of each update, a new keybox and `pubring.kbx.tmp` are created relative to a descriptor of their directory: the old name is removed with `unlinkat` (which removes a symlink itself, never its target), the file is created with `openat(O_CREAT | O_EXCL | O_NOFOLLOW)`, and it's used only if `fstat` on the new descriptor and `fstatat(AT_SYMLINK_NOFOLLOW)` on the name show the same regular file with one link. A symlink planted after the unlink makes `O_EXCL` fail, and gpg reports the error instead of writing.
- **Legacy keyrings and revocation certificates, too** (homescoop#1607 review). A `gnupg-ring:` keyring (`--keyring gnupg-ring:…`), its temporary file and a new keyring are created the same way, and its permissions are copied through a checked descriptor instead of `chmod` by name. The revocation certificate (`openpgp-revocs.d/<fingerprint>.rev`) is created with `O_EXCL` and without replacing anything already there, in an `openpgp-revocs.d` that must be a real directory (`fstatat(AT_SYMLINK_NOFOLLOW)` from its parent, then the same `st_dev`/`st_ino` through `openat`), and handed to that directory's owner on the same descriptor. A fingerprint can be known in advance (`Key-Grip` and `Creation-Date` fix it), so a planted `.rev` name is refused rather than followed: that key gets no revocation certificate, and gpg says so.
- **In-place edits never go through a planted symlink.** `--delete-key` (and other in-place keybox edits) open `pubring.kbx` for writing in place, and the trustdb is opened read-write the same way. When root does this, the file must be a regular file with one link, checked with `fstatat(AT_SYMLINK_NOFOLLOW)` on the directory's descriptor and opened with `openat(O_NOFOLLOW)` as that same `st_dev`/`st_ino`. Otherwise gpg fails instead of editing the file the link names. The one exception is a directory that root owns and only root can write, where only root could have made the link; there root's own symlinked setups keep working. Other users' gpg follows links as before. The trustdb that root creates is created like a keybox file.
- **The finished temporary file is renamed with `renameat`** on its directory's descriptor, and only while it is still a regular file with one link. The directory is the user's own, so a user who wins a race there only replaces their own keybox, which they can do anyway.
- **`openpgp-revocs.d` and its revocation certificates go to the homedir's owner** (homescoop#1602). When root's gpg generated a key in another user's homedir, the directory and the `.rev` stayed root's, so that user couldn't remove the homedir. They're handed over like the keybox and the trustdb, with the same directory-descriptor checks.
- **slicc-kernel 1.144.1** refuses a final symlink under `O_NOFOLLOW` (homescoop#1603), and the cert runs the symlink rows on it too. gpg keeps its `fstatat` and `st_dev`/`st_ino` checks, because a threaded WASIX program still has a window there until slicc-kernel#1394.
- **No build paths in the binaries** (homescoop#1601): since 2.4.9-13 (libgpg-error configured with `--sysconfdir=/etc`), no `bin/*.wasm` contains the build directory, and the cert checks that.

## 2.4.9-13

- **Owner hand-offs go through one directory descriptor** (homescoop#1442). When root's gpg creates a file in another user's directory (a keybox, its backup, a trustdb, a lock file, `private-keys-v1.d`), it gives it to the directory's owner. Up to 2.4.9-12 it looked the directory up by name for the owner and the file up by name again for the hand-off, so a user who swapped a directory on the path for a symlink in between could make root give away a file in a root directory. Now it opens the directory once, takes the owner from that descriptor, checks the name relative to it with `fstatat(AT_SYMLINK_NOFOLLOW)`, opens it relative to it, and hands over only that same file (`st_dev`/`st_ino`), and only a regular file with one link (or the new directory). The check doesn't rely on `O_NOFOLLOW`: on slicc-kernel (1.124.1 to 1.143.5) `open` with `O_NOFOLLOW` opens a symlink's target instead of failing, so 2.4.9-12's reopen didn't refuse a symlink there. Lock files are created relative to that descriptor. A keybox update takes the owner of the keybox it replaces only when that keybox is a regular file in the same directory, never through a symlink: a keybox that replaces a symlinked `pubring.kbx` belongs to the directory's owner.
- **The trustdb hand-off** (homescoop#1447) uses the same code. The 2.4.9-12 regression report came from an intermediate head of its PR (40b9ef7a); the published 2.4.9-12 hands the trustdb over. The cert row now requires the trustdb to exist, be the owner's, and work for the owner's `--clearsign`, `--list-keys` and `--check-trustdb`.
- **The package ships its committed `package.json` and `README.md`** (homescoop#1448). build.sh used to write its own `package.json` and copy an older README, so 2.4.9-12's plain description, `"helper": true` on `gpg-agent` and the 2.4.9-12 notes never shipped. They do now.
- **Reproducible builds** (homescoop#808): the package is rebuilt and compared in CI.

## 2.4.9-12

- **Trustdb hand-off checks the name** (homescoop#1111). When root's gpg creates a `trustdb.gpg` in another user's homedir, it gives the file to the homedir's owner through the name itself: it reopens the name with `O_NOFOLLOW` and gives away that descriptor, and only if it's a regular file with one link. A `trustdb.gpg` that cone symlinks to a root file is never handed over.
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
- Root and symlinks (2.4.9-15, homescoop#1654, #1674): root's gpg follows
  a symlinked `pubring.kbx`, keyring or `trustdb.gpg` only in a directory
  that root owns and that neither its group nor others can write (`chmod
  700` or `go-w`). Anywhere else it refuses the file and logs
  `refusing to open '<file>' as root: …` with the reason and the fix.
  Regular files with one link work everywhere.
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
