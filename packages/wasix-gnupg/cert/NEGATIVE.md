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

`cert/modes.mjs` against 2.4.9-4 (wasix-sysroot 2025.9.30-16) on
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
