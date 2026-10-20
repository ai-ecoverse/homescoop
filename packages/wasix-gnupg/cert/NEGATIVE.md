# Negative proof (wasix-gnupg)

**Date:** 2026-10-09
Patches under `patches/` are build fixes for WASIX (no fork, posix_spawn,
lock-obj); not in `scripts/ci-certified.json`. Runs on slicc-kernel 1.26.6
(Node entry).

## Empty wasm

With `bin/gpg.wasm` truncated to 0 bytes, the checklist fails at the first
`gpg`:

```
gpg --version: rc=126 stderr=bash: line 1: /usr/bin/gpg: I/O error
```

## Without slicc_stat_owner

`build.sh` refuses a sysroot whose `libc.a` has no `slicc_stat_owner.o`
(wasix-sysroot ≤ 2025.9.30-14). GnuPG's homedir ownership check needs
`st_uid == getuid()`, and the checklist asserts that a fresh homedir draws
no "unsafe" warning.

## Spec non-vacuous

A wrong symmetric passphrase must fail ("Bad session key", rc 2), and a
tampered file must be a BAD signature in gpgv (rc 1). Key types (ed25519,
cv25519), the PKESK packet tag and the decrypted bytes are compared exactly.

The published 2.4.9-2 (built on a Mac) passes as well. The CI build of the
same sources behaves the same.

## File modes (2.4.9-4, homescoop#169)

`cert/modes.mjs` against 2.4.9-4 (wasix-sysroot 2025.9.30-17) on
slicc-kernel 1.34.1, which has no slicc_fs imports: every file keeps the
store's default, and the spec fails.

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+   '.': '755',
+   'openpgp-revocs.d': '755',
+   'openpgp-revocs.d/<fpr>.rev': '644',
+   'private-keys-v1.d': '755',
+   'private-keys-v1.d/<keygrip>.key': '644',
```

On 1.35.1 it passes: 700 / 700 / 600, and a 755 homedir gets
"WARNING: unsafe permissions on homedir".

## 2.4.9-6: negative 2.4.9-5 (wasix-sysroot -20 → -28)

`agent-signals.mjs` on published 2.4.9-5 (slicc-kernel 1.93.0 Node entry, 2026-10-15): HUP, TERM and INT behave the same; the agent is idle in `npth_pselect` when the signal comes, so the masked-wait race that -28 closes (the sysroot's r28w window case) does not show here. It fails on the toolchain record: `wasix-sysroot -20` against `-28`. 2.4.9-5's checklist, modes and users (also under users enforce) pass on 1.93.0, so the rest of the cert is the regression run on the -28 libc (-21 to -28: pipe types, EINTR semantics, kernel owners and access, utimens, CPU times, masks).

## 2.4.9-8: dotlock as fcntl locks (homescoop#712, 2026-10-16)

`cert/concurrent.mjs` against the published 2.4.9-7 (slicc-kernel 1.106.2, users enforce): FAIL at the first case. gpg doesn't wait for the ruby process that holds an fcntl lock on `pubring.kbx.lock`: the order is `held, gpg rc=0, released`, and there is no "waiting for lock". Its dotlock uses an `O_EXCL` lock file, because OPFS has no hard links. In the parallel case (#712's repro), runs 1 and 3 of 4 failed with `invalid size of lockfile`, `can't lock '/root/cg/pubring.kbx': Invalid argument`, `DBG: Oops, '/root/cg/pubring.kbx.lock' is not locked` and `key generation failed: Not found`, and others logged `lockfile disappeared`. Only 2 of 4 keys were kept. 2.4.9-8 passes the spec in five runs out of five, and the other four specs pass on 1.106.2 too. In those runs, 0 to 2 of the 8 parallel runs per spec run failed an unlocked keybox read (`keydb_search failed: No such file or directory`), which is slicc-kernel#903. Each such run fails cleanly and writes nothing.

## 2.4.9-9: the keybox appears complete (homescoop#712, slicc-bios#496, 2026-10-17)

`cert/concurrent.mjs` (six concurrent `gpg --import` runs of distinct keys into a fresh homedir, three rounds as root and one as cone, with no error tolerance) against the published 2.4.9-8 on slicc-kernel 1.118.1 (Chrome, OPFS root, users enforce) FAILs in three runs out of three, in round 1 or 2. One or two imports per round log `invalid packet (ctb=00)`, `keydb_get_keyblock failed: Value not found`, `pubring.kbx: copy to 'pubring.kbx.tmp' failed: Invalid packet` and `error writing keyring 'pubring.kbx': Invalid packet`, exit 2, and lose their key (round 1 kept 4 of 6). The cause is gnupg's own, and native gpg 2.4.4 on Linux shows it too (90 of 200 rounds lost keys, per thr_azw9jz9aaw's run). `rt_from_file()` probes `pubring.kbx` without the lock, and `maybe_create_keyring_or_box()` creates the keybox empty and writes its header afterwards. So a gpg that probes in between takes the keybox for an OpenPGP keyring, and `keyring.c` fails on the KBX bytes. A kernel trace (thr_azw9jz9aaw) shows no two holders of `pubring.kbx.lock` and no stale read after a rename.

2.4.9-9 (two hunks in `g10/keydb.c`): the new keybox is written to `pubring.kbx.tmp` and renamed into place, so it only ever appears complete (renames are atomic for other processes since slicc-kernel 1.117.2, slicc-kernel#925). A probe that finds the file shorter than a keybox header probes again under its dotlock. 2.4.9-9 passes the spec in four runs out of four on 1.118.1 (four more with only the first hunk), and the full cert (five specs) passes on the cert kernel 1.118.1. The parallel `--quick-gen-key` case no longer tolerates `invalid packet` or `keydb_search failed` (#934): with renames atomic, every run must exit 0 and keep its key.

## Existing keybox (homescoop#956, 2026-10-17)

`cert/concurrent.mjs` gained rounds that import the six keys concurrently into a homedir whose `pubring.kbx` already exists: once empty (`gpg -k` ran first), and four times holding six other keys (tide7 … tide12; three rounds as root, one as cone). Every imported and every held key must be kept, with no error line. Native gpg loses keys here: GnuPG 2.5.21 on macOS (APFS, link()-based dotlock), 100 rounds per case, lost a key in 20 rounds with a fresh homedir, 9 with an empty keybox and 15 with a held one, logging `lockfile disappeared`, `keydb_get_keyblock failed: Value not found`, `no writable keyring found: Not found` and `import from 'kN.gpg' failed: General error`. 2.4.9-9 passes the spec in nine runs out of nine on slicc-kernel 1.118.1 (Chrome, OPFS root, users enforce), plus three runs of a 30-round variant (20 rounds with held keys, 10 with an empty keybox) with no loss. Its dotlock is an fcntl lock (2.4.9-8), so the link()-based dotlock races behind `lockfile disappeared` don't exist on WASI. The fresh-homedir rounds still fail on 2.4.9-8 (above), so the spec isn't vacuous. The existing-keybox rounds guard 2.4.9-10 and later.

## 2.4.9-10: readers, lock files, gpgconf --lock (homescoop#966, #955, #888, #881; 2026-10-17)

All against the published 2.4.9-9 on the cert kernel 1.120.2 (Chrome, OPFS root, users enforce). 2.4.9-10 (wasix-sysroot -34) passes the full cert (six specs) in five runs out of five on 1.120.2.

- **#966, `concurrent.mjs` part 2b:** FAIL. After an import, `pubring.kbx` and a new `pubring.kbx.tmp` have the same st_ino (`kbx=2799070107900188 tmp=2799070107900188`). 2.4.9-9 writes every update to `pubring.kbx.tmp` and renames it over, and slicc-kernel#954 gives a file created under a just-renamed-away name the renamed file's st_ino. So a reader that opens `pubring.kbx` can read the wrong file's bytes. An instrumented gpg showed the reader's fd at the current inode, one key blob longer than the offset it was reading, and that blob read as zeros (pread too). The readers fail: in a 15-round loop (four readers, six imports into a keybox holding six keys), 2 to 3 rounds out of 15 had a `gpg -k` or `--list-keys` exit 2 with `keydb_search_next failed: Provided object is too short`. No import failed and no key was lost (all twelve keys after every round, in about 130 rounds). With a unique tmp name per update, 0 of 30 such rounds failed. The spec runs one reader round, not more: longer loops run into slicc-kernel#980 (an OPFS call that never answers, then ETIMEDOUT from rename/open). That happens on 2.4.9-9 too, in about 1 round in 15.
- **#955, `locks.mjs` part 1:** FAIL. Cone's `gpg --no-default-keyring --keyring /srv/ro/empty.gpg --list-keys` gives `can't create '/srv/ro/empty.gpg.lock': Permission denied`, rc 2.
- **#888, `locks.mjs` part 2** (run with part 1 removed): FAIL. After root's `gpg -k` and `gpg-connect-agent` on cone's homedir, its lock files are `root 644`. In a separate run of only the stale-lock rows, cone's `--quick-gen-key` with a root-owned `pubring.kbx.lock` fails: `can't create '/home/cone/h/pubring.kbx.lock': Permission denied`, `key generation failed`, rc 2.
- **The symlink row of `locks.mjs` part 2:** cert-review on #1007's first head (e605cad1) found that root's gpg followed a lock name that cone had pointed at a root file (`pubring.kbx.lock -> /etc/sudoers`) and `fchown`ed the target to cone. That head fails the row. The fix: root gives away only a lock file that its own `open(O_CREAT|O_EXCL)` created, and only a regular file with one link. On the published 2.4.9-9 the row passes, because nothing is given away there.
- **#881, `locks.mjs` part 3** (run alone): FAIL. `gpgconf --unlock` gives `release_dotlock: not our lock`, and there's no "not supported" message. With gpg's lock files present, `--lock` itself fails with `invalid size of lockfile` (#881's report).

`dotlock_fcntl_reclaim` checks for a holder with a non-blocking `F_RDLCK` on a read-only descriptor, not with `F_GETLK`. In gpg, `F_GETLK` on such a descriptor reported `F_WRLCK` with no holder, while wasix-ruby's `fcntl(F_GETLK)` on the same file said `F_UNLCK`. That isn't followed up here.

## 2.4.9-11 (homescoop#1031, #1072, #1039)

**Date:** 2026-10-18. The published 2.4.9-10 against 2.4.9-11's `cert/locks.mjs`, on slicc-kernel 1.124.1 under users enforce, `--soft`: **FAIL, 8 cases.**
- After root's `gpg --homedir /home/cone/h --batch --import` of a public key, `/home/cone/h/pubring.kbx` is `root`.
- cone's `--quick-gen-key` then fails with `gpg: no writable public keyring found: Not found` / `key generation failed: Not found`, and so does the `--clearsign` that needs that key.
- In cone's empty `/home/cone/h2`, root's import leaves `pubring.kbx`, `trustdb.gpg` and `private-keys-v1.d` root-owned, and cone's `--quick-gen-key` fails with `agent_genkey failed: Permission denied`.

2.4.9-11 gives each of these (and the update's backup `pubring.kbx~`) to the owner of the directory or of the keybox it replaces. As with #888's lock files, it only does that for a regular file with one link (a directory for `private-keys-v1.d`) that this gpg created, opened without following a symlink. The existing check that a symlinked lock file's target stays `root 644` still holds.

`cert/concurrent.mjs`'s readers round now runs three rounds (#1072), on cert kernel 1.124.1, where slicc-kernel#980 is fixed. The note above about running one round because of #980 applies to 2.4.9-10 and its kernel 1.120.2. The README's #954 note now says 1.123.1 (#1039).

## 2.4.9-12: trustdb hand-off through a symlink (homescoop#1111; 2026-10-20)

The new `locks.mjs` row is latent on the published 2.4.9-11, as the issue says: on today's kernels gpg stops before the `fchown` (`Fatal: can't create …/trustdb.gpg: No such file or directory` for the dangling link, `File exists` for the link to a root file), so `/etc/poc` stays root's on both versions. The row pins the outcome; the fix in `g10/tdbio.c` reopens the name with `O_NOFOLLOW` and chowns that descriptor (patches/gnupg-2.4.9-wasi.patch), so a symlinked name never hands anything over, whatever the kernel does. A first try compared `lstat`'s `st_dev`/`st_ino` with `fstat`'s, but on slicc-kernel 1.132.1 the two don't match for the same file, and that broke the #1031 row (`/home/cone/h2/trustdb.gpg root`, ladder-pr on 982ae3d9). `agent-signals.mjs`'s toolchain-record assertion moves from the description to README.md.
