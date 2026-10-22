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

The new `locks.mjs` row is latent on the published 2.4.9-11, as the issue says: on today's kernels gpg stops before the `fchown` (`Fatal: can't create …/trustdb.gpg: No such file or directory` for the dangling link, `File exists` for the link to a root file), so `/etc/poc` stays root's on both versions. The row pins the outcome; the fix in `g10/tdbio.c` reopens the name with `O_NOFOLLOW` and chowns that descriptor (patches/gnupg-2.4.9-wasi.patch), so a symlinked name never hands anything over, whatever the kernel does. Two earlier tries (an `lstat`/`fstat` comparison, then this reopen) broke the #1031 row (`/home/cone/h2/trustdb.gpg root`, ladder-pr on 982ae3d9 and 40b9ef7a). The cause was in gnupg, not the kernel: `db_name` is `fname`, and `*p = 0` had already cut it down to the homedir, so both looked at the directory. The name is now opened before the cut. `agent-signals.mjs`'s toolchain-record assertion moves from the description to README.md.

## 2.4.9-13: hand-offs through one directory descriptor, the trustdb row, the shipped package.json (homescoop#1442, #1447, #1448; 2026-10-21)

All against the published 2.4.9-12 on the cert kernel 1.124.1 (Chrome, OPFS root, users enforce, `--soft`). 2.4.9-13 (local build of this branch) passes the full cert (seven specs) on 1.124.1.

- **#1447, `locks.mjs`'s #1031 row:** the published 2.4.9-12 passes. The report came from 40b9ef7a, an intermediate head of #1419, where tdbio's `db_name` (the same buffer as `fname`) had already been cut to the homedir by `*p = 0`. The row caught it there (ladder-pr 39432557497) and on 982ae3d9, and 196ea681 (the merged head) fixed it before the release. The issue's own repro on 2.4.9-12 gives `/home/cone/h9/trustdb.gpg cone cone 600`, and cone's `--quick-gen-key` and `--check-trustdb` exit 0. The row used to check the trustdb's owner only if the file existed (`[ -e … ] && stat`). It now requires `trustdb.gpg cone` and `private-keys-v1.d cone`, and cone's `--clearsign`, `--list-keys` and `--check-trustdb` after `--quick-gen-key`, as in the issue.
- **#1442, `locks.mjs`, a `pubring.kbx` that cone symlinks to root's 644 keybox `/srv/kb/pubring.kbx`:** FAIL, 3 cases. After root's `gpg --homedir /home/cone/hr --batch --import` of a second key, `/home/cone/hr/pubring.kbx` and `pubring.kbx~` are regular files owned by `root` (`ref /home/cone/hr/pubring.kbx regular file root`), and cone's `--quick-gen-key` then fails with `no writable public keyring found` (`gen=2`). 2.4.9-12 took the new keybox's owner from `stat(fname)`, which follows the symlink to root's file. 2.4.9-13 takes it from `fstatat(dfd, "pubring.kbx", AT_SYMLINK_NOFOLLOW)` and only from a regular file, so a symlink gives the directory's owner, cone. Root's own keybox stays `root 644` and byte-identical on both.
- **#1442, the swap rows:** root runs gpg on `/home/cone/hs` (a symlink cone made to root's 700 `/srv/rh`), and on `/home/cone/hm/g` before and after cone renames `~/hm` away and puts a symlink to root's `/srv/rm` in its place. Every file under `/srv/rh` and `/srv/rm` stays root's, and the moved-away homedir stays cone's. These are guards: they pass on 2.4.9-12 as well, because without a race both of its by-name lookups see the same directory. The race that #1442 closes (a swap between the owner lookup and the file lookup) has no deterministic row. In 2.4.9-13 the owner comes from `fstat` on one directory descriptor, and the file is checked with `fstatat(AT_SYMLINK_NOFOLLOW)` (a regular file, or a directory for `private-keys-v1.d`), opened with `openat` on that descriptor, and given away only if `fstat` on that descriptor shows the same `st_dev`/`st_ino`, a regular file with one link (or a directory). Lock files are created with `openat(dfd, …, O_CREAT | O_EXCL)` and given to `fstat(dfd)`'s owner.
- **Why `fstatat` and the inode check:** on slicc-kernel 1.124.1 and 1.143.5, `open(symlink, O_RDONLY | O_NOFOLLOW)` opens the symlink's target instead of failing with `ELOOP` (a wasix-ruby probe: `File.open("/srv/q/l", File::RDONLY | File::NOFOLLOW)` reads the target, and `lstat` says `link`). So 2.4.9-12's `O_NOFOLLOW` reopen (#1111) never refused a symlink on these kernels. Its row passes only because gpg stops earlier. `lstat`/`fstatat` do see the link, and `st_ino` is the same through `lstat` and `fstat`, and across a rename.
- **#1448, `meta.mjs`:** FAIL, 6 cases. 2.4.9-12's tarball has build.sh's old description (`GnuPG 2.4 for slicc WASIX: … (wasix-sysroot -34: …)`), `gpg-agent` without `"helper": true`, and the recipe README with no `## 2.4.9-12` section. The version assertion fails as well, of course. build.sh now checks the committed `package/package.json` and ships it as it is, and the recipe-level README.md (an old copy) is gone, so `package/README.md` ships.

## 2.4.9-14: no writes through a planted symlink, openpgp-revocs.d, build paths, slicc-kernel 1.144.1 (homescoop#1607, #1602, #1601, #1603; 2026-10-22)

The published 2.4.9-13 and 2.4.9-12 against 2.4.9-14's `cert/links.mjs` and `cert/meta.mjs`, Chrome, OPFS root, users enforce, `--soft`. 2.4.9-14 (a local build of this branch on wasix-sysroot -34) passes all eight specs on the cert kernel 1.124.1, and `links.mjs` and `locks.mjs` with `GNUPG_NOFOLLOW=1` on 1.144.1.

- **#1607, `links.mjs`, on 1.124.1:** 2.4.9-13 FAILs 11 of 26 assertions. After root's `gpg --homedir /home/cone/g --batch --import`, root's 600 `/srv/v/victim` (the target of cone's `~/g/pubring.kbx~`) holds cone's keybox instead of `SECRET victim` (`cksum` 2683138697 32), and `/srv/v/t2` (the target of cone's `~/f/pubring.kbx.tmp`) holds the 32-byte keybox header. Both stay `root 600`, and `~/g/pubring.kbx~` is still the symlink. 2.4.9-12 FAILs 13: the same, and both targets are `cone 600`. 2.4.9-14 removes the name with `unlinkat`, creates the file with `openat(dfd, O_CREAT | O_EXCL | O_NOFOLLOW)` and checks `fstat` against `fstatat(AT_SYMLINK_NOFOLLOW)`, so both targets stay byte-identical and `root 600`, and the keyboxes are regular files of cone's. A dangling `~/d/pubring.kbx~` to `/srv/v/new` is a guard: no version creates `/srv/v/new` on these kernels.
- **#1607 on 1.144.1:** 2.4.9-13 still FAILs 11 of 28 (the same overwrites, and its import into `~/d` fails). The kernel's `O_NOFOLLOW` fix doesn't help a `fopen("wb")`, which doesn't ask for it.
- **#1602, `links.mjs`:** 2.4.9-13 and 2.4.9-12 FAIL. After root's `--quick-gen-key` in cone's empty 700 `/home/cone/q`, `openpgp-revocs.d` is `root 700` and its `.rev` is `root 600`, and cone's `rm -rf ~/q` fails with `Permission denied`. 2.4.9-14 hands the directory (when it creates it) and the `.rev` to the homedir's owner through `gnupg_wasi_give_to_owner`.
- **#1603, `links.mjs` with `GNUPG_NOFOLLOW=1`:** on 1.124.1 wasix-ruby's `File.open("/srv/nf/l", File::RDONLY | File::NOFOLLOW)` opens the target (`l opened target`), FAIL. On 1.144.1 it is `Errno::ELOOP`, PASS. That's the kernel row, so it runs only on the extra kernel.
- **#1601, `meta.mjs`:** 2.4.9-12 FAILs: every `bin/*.wasm` contains `/home/runner/work/homescoop/homescoop/packages/wasix-gnupg/.work/prefix/etc`. 2.4.9-13 already passes (b1f6c2af configured libgpg-error with `--sysconfdir=/etc`; ladder-pr's `reproducible (wasix-gnupg)` was green on #1598's head, run 39657934484), and so does 2.4.9-14.
- **The review rows (`links.mjs`, the .rev and `gnupg-ring:` parts), on 1.124.1:** 2.4.9-13 FAILs 20 of 43 with them. A key generated from a fixed `Key-Grip` and `Creation-Date` has the fingerprint cone computed in advance. With `~/q5/openpgp-revocs.d/<fpr>.rev` symlinked to root's 600 `/srv/rv/existing`, root's `gpg --batch --yes --generate-key` overwrites that file with the 1,165-byte revocation certificate (it stays root 600). With `~/q4/openpgp-revocs.d` symlinked to root's `/srv/rd`, root's `--quick-gen-key` creates `/srv/rd/<fpr>.rev`. With `~/k2/pub.gpg` empty and `~/k2/pub.gpg.tmp` symlinked to root's 600 `/srv/kr/kt`, root's `--keyring gnupg-ring:/home/cone/k2/pub.gpg --import` overwrites kt, and `~/k2/pub.gpg` becomes root's. Two rows are guards on this kernel: a dangling `<fpr>.rev` (`~/q3`) and a dangling `~/k/pub.gpg`. 1.124.1 refuses to create through a dangling symlink (`No such file or directory`), so 2.4.9-13 creates nothing there either; its `~/k` import fails. 2.4.9-14 passes all of it, on 1.124.1 and on 1.144.1.
- **In-place edits (`links.mjs`, coordinator's follow-up), on 1.124.1:** 2.4.9-13 FAILs 23 of 49. With cone's `~/dk/pubring.kbx` symlinked to root's own `/root/lk/pubring.kbx`, root's `gpg --homedir /home/cone/dk --batch --yes --delete-key <fpr>` exits 0 and deletes the key from root's keybox: it no longer lists the key (`still=2`), and the checksum changes. With `~/dt/trustdb.gpg` symlinked to `/root/lk/trustdb.gpg`, root's `--import-ownertrust` there writes the record into root's trustdb. 2.4.9-14 refuses both (for root, a regular file with one link, checked on the directory's descriptor), so both files are byte-identical. The full cert passes on 1.124.1, and links plus locks on 1.144.1.

## 2.4.9-15: no reads through a planted symlink (homescoop#1654, #1424; 2026-10-22)

The published 2.4.9-14 against 2.4.9-15's `cert/links.mjs` and `cert/locks.mjs`, on the cert kernel 1.124.1 (Chrome, OPFS root, users enforce, `--soft`): **FAIL, 9 of 80 in links.mjs and 3 of 73 in locks.mjs.**

- **#1654, `links.mjs`:** root makes a keybox and a legacy keyring holding a `RootOnly <ro@example.org>` key, `root 600` in `/srv/sk`. cone symlinks `~/s1/pubring.kbx` and `~/s2/pubring.kbx` to the keybox and `~/s3/pub.gpg` to the keyring (cone's `cat` of the link fails). Root's `--import` into `~/s1`, `--quick-gen-key` in `~/s2` and `--keyring gnupg-ring:/home/cone/s3/pub.gpg --import` all exit 0 on 2.4.9-14, and afterwards `~/s1/pubring.kbx`, `~/s1/pubring.kbx~`, `~/s2/pubring.kbx`, `~/s2/pubring.kbx~` and `~/s3/pub.gpg` are regular files that cone reads, all holding `RootOnly`, and cone's `gpg -k ro@example.org` in `~/s1` and `~/s3` lists root's key. `/srv/sk` stays root 600 and byte-identical on both versions. 2.4.9-15 refuses all three (rc 2), leaves cone's symlinks, and no file cone can read in those homedirs holds the key.
- **#1442's row in `locks.mjs` changes:** a `pubring.kbx` that cone symlinks to root's 644 `/srv/kb/pubring.kbx`. 2.4.9-13 and 2.4.9-14 replace the symlink with a cone-owned keybox and backup that hold root's keys (`imp=0`, `ref …/pubring.kbx regular file cone`, `ref …/pubring.kbx~ regular file cone`). 2.4.9-15 refuses the import, the symlink stays, there's no `pubring.kbx~`, and anything left there is cone's. cone's own gpg still reads the 644 keybox through its link.
- **#1424 rows (guards, pass on 2.4.9-14 too):** root's `-k`, `--import-ownertrust` and `--delete-secret-and-public-key` on cone's regular `~/rg` (rc 0, the key is gone, the files are still cone's); root's `-k`, `--import-ownertrust` and `--delete-key` through root's own symlinks in its 700 `/root/rs` (rc 0, edits land in `/root/ro`); `~/q1/private-keys-v1.d` symlinked to root's `/srv/pk` and `~/q2/pubring.kbx.lock` symlinked to a missing `/srv/lk/newfile` (after root's `--quick-gen-key`, everything under `/srv/pk` is root's and `/srv/lk` is empty); and root's import into `~/rb` whose `pubring.kbx` root gave to a second user `ctwo` keeps `pubring.kbx` and `pubring.kbx~` ctwo's. They guard the new read path: every root read of a user's keybox or trustdb now goes through `gnupg_wasi_open_file`.
