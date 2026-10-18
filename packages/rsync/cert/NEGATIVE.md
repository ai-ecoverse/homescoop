# Negative proof (rsync)

**Date:** 2026-10-09
New package, so it needs human cert first and is not in `scripts/ci-certified.json`.



## No process credentials (published 3.4.4-3, users enforce)

`users.mjs` on slicc-kernel 1.69.0 with users `enforce` (Node entry, 2026-10-13): 3.4.4-3 predates the cred shim (#207), so rsync does not know it is root. Root's `rsync -a` of cone's 1000:1000 tree gives `0:1000` everywhere (group kept, owner not), and cone's copy of a `0:100` file gives `1000:1000` (its supplementary group 100 is not seen). 3.4.4-4 gives `1000:1000` and `1000:100`.

## 3.4.4-2 has no socket shim (3.4.4-3, netfork)

3.4.4-2 linked the `fork` shim profile, without `slicc_socket.c`. Every
rsync:// connection went to Emscripten's own socket layer and never
returned. Against 3.4.4-2, slicc-kernel 1.30.0's Node entry:

- `daemon.mjs`: the module list never comes (`== list` with no `mod`).
- `tailnet.mjs`: `rsync rsync://peer.tail1234.ts.net/` is killed by
  `timeout 20` (rc=124) instead of failing with "Connection refused" (rc 10).

On slicc-kernel 1.31.0, 3.4.4-2 fails fast instead of hanging (cert by
thr_hb2dpaitvt): the module list exits rc 10, and the tailnet client reports
"Host is unreachable" to an address from Emscripten's own fake DNS
(172.29.x), never asking the kernel resolver. Either way both specs fail.

3.4.4-3 passes both.

## 3.4.4-2 on slicc-kernel 1.29.0 (before the #170 fix)

3.4.4-2 sets link times as upstream does. On a kernel whose
`utimensat(AT_SYMLINK_NOFOLLOW)` still follows the link, that stamps the
target, here the SOURCE file behind an absolute link (`ls/abs ->
/home/ls/t.txt`), Node entry 1.29.0:

```text
rsync -a -i ls/ ld/ → rc 23
ls/t.txt 1791584599        (was 1577934245: the source was modified)
rsync: [generator] failed to set times on "/home/ld/rel": No such file or directory (44)
```

The checklist fails on 1.29.0 even earlier, at its `touch -h` setup. On
1.30.0 (fix shipped in 1.29.2) every case passes. So the kernel fix is what
makes 3.4.4-2 safe, hence `engines` `slicc-kernel >=1.29.2`.

## Empty wasm

With `bin/rsync.wasm` truncated to 0 bytes, the checklist fails at the first
`rsync` run (slicc-kernel 1.26.4, Node entry):

```
rsync --version: rc=126 stderr=bash: line 1: /usr/bin/rsync: I/O error
```

## Without the select() wrapper

The first build linked rsync against Emscripten's own `select()`, which never
blocks (the slicc shims only replace `pselect()` and `poll()`). It copied
trees correctly, but a 3 MB `--bwlimit=500` copy finished in under a second,
so the Ctrl-C case had nothing left to interrupt (`rc=0`, not 20), and the
`--bwlimit` case fails its ≥ 1.5 s bound. `slicc_rsync_select.c` maps
`select()` to the shim's `pselect()`; with it both cases pass.

## Without slicc-omit-link-times.patch

The build without the patch (CI run 37961018566, tarball de55229b…) fails the
symlink case on slicc-kernel 1.26.5: the kernel's
`utimensat(AT_SYMLINK_NOFOLLOW)` follows the link (slicc-kernel#170).

```
rsync -a -i ls/ ld/: rc=23 stderr=rsync: [generator] failed to set times on "/home/rs/ld/dang": No such file or directory (44)
rsync: [generator] failed to set times on "/home/rs/ld/dl": No such file or directory (44)
rsync: [generator] failed to set times on "/home/rs/ld/rel": No such file or directory (44)
rsync error: some files/attrs were not transferred (see previous errors) (code 23) at main.c(1356) [sender=3.4.4]
```

## Default -J only (no refusal), tarball d07515dd…

`--no-J` turned the broken path back on. Through the absolute link it
stamped the source file's mtime. The option matrix fails at the first
refused case (slicc-kernel 1.26.5):

```
-a --no-omit-link-times: rc=23 stderr=rsync: [generator] failed to set times on "/home/rs/lr/dang": No such file or directory (44)
```

## Spec non-vacuous

`cert/checklist.mjs` compares the exact `--itemize-changes` lines of a fresh
copy, snapshots path, mode, mtime and md5 of every entry in source and
destination, reads `--stats` transfer counts, checks that `--dry-run` leaves
the destination untouched, that `-c` changes the outcome of an equal
size-and-mtime pair, exact exit codes (23 for a missing source, 20 for SIGINT)
and that no `rsync` process survives an interrupt.

## Kernel issue, fixed in slicc-kernel 1.73.3: the destination's top directory lost its mtime (1.36.0-1.73.2)

Not a negative of this package: `checklist.mjs` fails on every slicc-kernel from 1.36.0 on, for the published 3.4.4-3 as well as 3.4.4-4, with users `off` too (Node entry, 2 tries each, 2026-10-13: PASS on 1.30.0, 1.32.3, 1.34.1, 1.35.0, 1.35.1; FAIL on 1.36.0, 1.37.1, 1.39.0, 1.44.0, 1.48.0, 1.61.0, 1.66.0, 1.69.0):

```text
AssertionError: -a re-run itemized:
+ '.d..t...... ./\n'
```

Minimal: `mkdir s && echo a > s/f && touch -d @1500000000 s && rsync -a s/ d/; stat -c %Y s d` gives 1500000000 for `s` and the current time for `d`. Subdirectories keep their times; shell steps (create or rename an entry, then utime the directory) keep them too. rsync's generator sets the directory's time while its receiver, another process, renames files into it. 1.36.0 added directory mtime updates on add/remove/rename (slicc-kernel af0d626, c6120b4). Fixed in slicc-kernel 1.73.3 (#467); 3.4.4-4 was certified on 1.69.0 with this failure recorded, and the checklist passes again on 1.73.3.

## Kernel issue, fixed in slicc-kernel 1.73.3: a user's rsync -a of a symlink exits 23 (slicc-kernel#449)

On slicc-kernel 1.73.2 and older, an Emscripten program's own `lstat` of a symlink it just created reported owner 0:0, so a user's `rsync -a` passed that uid to `lchown` (`lchown(l, 0, 1000)`) and got EPERM: rc 23, `chgrp "/home/cone/d/l" failed: Operation not permitted (63)`, the links themselves fine (cone:cone). 1.73.3 gives rc 0 (`users.mjs`).

## 3.4.4-5: negative 3.4.4-4 for the self-kill

3.4.4-5 is 3.4.4-4 relinked with the slicc shims' self-kill (homescoop#290). The checklist and users specs pass on both; the delta is the shim, which `scripts/check-slicc-cred.mjs` and the shim's own test cover. The README drops the top-directory mtime limit, fixed in slicc-kernel 1.73.3.

## 3.5.x symlink hardening in the destination (homescoop#411, 2026-10-16)

`symlink-dest.mjs` against the published 3.4.4-5 on slicc-kernel 1.92.0, users enforce: FAIL. cone's `rsync -a ~/s/d /tmp/evelink/`, through eve's symlink, exits 0 and copies (3.5.1: rc 3, "refusing to follow a symlink owned by an untrusted user"). With that case left out, root's `rsync -aK /tmp/k/src/ /tmp/k/dA/`, into a dirlink to the absolute `/tmp/k/elsewhere`, exits 0 and writes through it (3.5.1: rc 23, "Symbolic link loop"). 3.5.1-1 passes, and so do the other four specs on it.

## 3.5.1-3: daemon client names (homescoop#176, 2026-10-16)

`daemon.mjs` against the published 3.5.1-2 (3.5.1-1's binary) on slicc-kernel 1.92.0, users enforce: FAIL. Every connection logs `name lookup failed for 127.0.0.1: Name does not resolve`, then `connect from UNKNOWN (127.0.0.1)`. The `[lh]` module (`hosts allow = localhost`, `hosts deny = *`) refuses the pull with `@ERROR: access denied to lh from UNKNOWN (127.0.0.1)`, rc 5, and the `[nolh]` module (`hosts deny = localhost`) lets it in, rc 0. Emscripten's JS getnameinfo knew only its own fake-DNS addresses, so `NI_NAMEREQD` on 127.0.0.1 was `EAI_NONAME`. 3.5.1-3 links the socket shim's getnameinfo (`/etc/hosts`, then loopback) and passes.

## 3.5.1-5: no DWARF, no build paths (homescoop#908; 2026-10-17)

`node scripts/check-no-debug.mjs rsync` (host-run's #908 check) fails on the published 3.5.1-4: 1 file(s) ship 1,612,779 bytes of DWARF.

The published 3.5.1-4 also has 1 occurrence(s) of the CI build directory `/tmp/homescoop-work` in bin/rsync.wasm (`__FILE__` strings and DWARF), so the bytes depend on where it was built.

3.5.1-5 is built with `-ffile-prefix-map` (the checkout as `/src`, WORK as `/build`, PREFIX as `/prefix`), and host-run strips every wasm module, archive and object with `llvm-objcopy --strip-debug`. The name section stays, and check-no-debug asserts that no other section is lost. The package code is unchanged, so its specs pass on 3.5.1-4 too; the negative is the #908 check.
