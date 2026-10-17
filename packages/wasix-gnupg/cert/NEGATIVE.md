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
