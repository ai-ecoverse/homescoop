# Negative proof (zip)

## 3.0.0-4 (homescoop#582, #608)

**Date:** 2026-10-16, slicc-kernel 1.94.0, users enforce, the same setup as below. 3.0.0-4 passes every spec and `cert/noshell/`.

unzip carries 24 of Debian unzip 6.0-31's `debian/patches`, verbatim, as `unzip-debian-NN-<name>.patch`, where NN is the patch's place in Debian's `series`. They come from `unzip_6.0-31.debian.tar.xz`, sha256 `d7dc23f5254c6711dc05f467e70236cfd50a7931001c6152904474b19f295c38`. They apply in that order to `unzip_6.0.orig.tar.gz` with no fuzz:
- the security fixes;
- `05` and `17`, which `32` needs in order to apply.

Left out: the branding, man page, zipgrep, build-date (we pin `SOURCE_DATE_EPOCH`) and build-only patches. Debian's `28` (CVE-2022-0529/0530) replaces 3.0.0-3's trimmed copy, and `unzip-escape-bound.patch` is rebuilt on top of it. `unzip-unipath-short.patch` is ours.

`hostile.mjs` (`--soft`) on the published 3.0.0-3 fails every case below except the prefixed archive. `roundtrip.mjs` fails its zipinfo lines with `zipinfo: command not found`, rc 127 (#608).

Each patch below was taken out of the 3.0.0-4 recipe, the rebuild run with the others applied:

| Patch | Case, without the patch |
| --- | --- |
| `08` allow-greater-hostver-values | `hostver 10.0: unzip -Z version column` fails |
| `11` CVE-2014-8141 | no build: `28` needs it. 3.0.0-3: `unzip -l` rc 0 with no corrupt-field warning, `unzip -d` rc 2 |
| `14` CVE-2015-7696 | passes: `16` covers the case. Ablation |
| `16` fix-integer-underflow-csiz-decrypted | encrypted entry: rc 3, no "invalid compressed data", a wrapped size (`-t` and `-d`) |
| `18` CVE-2014-9913 | `unzip -v lists method UnkFFFF` fails |
| `19` CVE-2016-9844 | `unzip -Z lists method FFFF` fails |
| `23` CVE-2019-13232 (overlapped entries) | no build: `24` and `26` need it. 3.0.0-3: rc 1, and `b.txt` is written |
| `24` CVE-2019-13232 (misplaced central directory) | the prefixed-archive case passes with and without it. Ablation; the case is kept as a regression check |
| `unzip-unipath-short` | `short Unicode Path: no Unicode Path warning` fails, twice |

**Ablation only.** Each of these has no case of its own: no deterministic, observable outcome in this build, or the code isn't compiled.
- `05` fix-uid-gid-handling and `32` CAN-2026-2034440: mostly under `IZ_HAVE_UXUIDGID`, which this build doesn't define. `05` and `17` are there for `32` to apply.
- `06` initialize-the-symlink-flag, `07` increase-size-of-cfactorstr.
- `09` CVE-2014-8139, `10` CVE-2014-8140, `12` CVE-2014-9636.
- `15` CVE-2015-7697 and `25` (bzip2): bzip2 support is not compiled in.
- `20` CVE-2018-1000035 (the password prompt).
- `22` and `26`: CVE-2019-13232 follow-ups, under the overlapped-entries case together with `23`.
- `33` CAN-2026-2034443, `34` CAN-2026-2034442.
- `28` CVE-2022-0529/0530 runs under `utf8.mjs`'s `unzip -U` passes (see 3.0.0-3).

## 3.0.0-3 (homescoop#570, CVE-2022-0529/0530)

**Date:** 2026-10-16, slicc-kernel 1.94.0, users enforce, with the same setup as 3.0.0-2 below.

3.0.0-2's `UNICODE_SUPPORT` (#431) turned on unzip 6.0's Unicode name code. 3.0.0-3 fixes three problems in it:

- **CVE-2022-0529/0530.** Debian's fix (unzip 6.0-31, `cve-2022-0529-and-cve-2022-0530.patch`) is carried as `unzip-cve-2022-0529-0530.patch`, without its two `getZip64Data` hunks, which depend on Debian's CVE-2014-8141 patch. `utf8.mjs`'s `unzip -U` pass runs that code (below).
- **#570's new case.** unzip took a Unicode Path extra field even when it isn't UTF-8, and then couldn't create the file. 3.0.0-1 ignored the field.
- **The `-U` arm that fix missed** (`unzip-escape-bound.patch`, below).

The 3.0.0-3 recipe, rebuilt without `unzip-unipath-utf8.patch` (every other patch applied), fails only `utf8.mjs` (`--soft`). Its entry `n.txt` has a Unicode Path field holding `ff c0 80 ed a0 80 2e`. These are the first failures; the `-U` ones follow, below:

```
FAIL utf8.mjs:27#5 | unzip -l shows n.txt
FAIL utf8.mjs:31   | unzip -d: rc 50
                     error:  cannot create out/�����.
                             Illegal byte sequence
FAIL utf8.mjs:34#5 | out/n.txt: cat: out/n.txt: No such file or directory
```

The published 3.0.0-2 (`d212c879…`) fails the same way. 3.0.0-3 extracts `out/n.txt` with its bytes, and every spec and `cert/noshell/` pass.

**`unzip -U` (homescoop#583).** `-U` escapes every non-ASCII name (`#L01f600.txt`) through `utf8_to_local_string` → `wide_to_local_string`, the code with CVE-2022-0529/0530 in it. `utf8.mjs` runs `unzip -U -l` and `unzip -U -d` on `esc.zip`, which holds:
- a CP437 name with a Unicode Path field that isn't UTF-8;
- `e.txt` with a Unicode Path of `😀.txt`;
- `café.txt` (bit 11).

| Build | `utf8.mjs` lines 53–63 (`-U`) |
| --- | --- |
| 3.0.0-3 | pass |
| without `unzip-cve-2022-0529-0530.patch` | pass: the UTF-8 check drops the field before it reaches that code |
| without `unzip-unipath-utf8.patch` | `unzip -U -l: rc 2` and `-U -d: rc 2`, `error: Unicode filename corrupt.` (the CVE fix catching the bad field), but no `RuntimeError` |
| neither (the published 3.0.0-2) | also `RuntimeError: memory access out of bounds`, rc 70, for both |

**`unzip -U` of 31-bit characters (`unzip-escape-bound.patch`, Codex P1 on #579).** unzip still decodes 5- and 6-byte UTF-8 sequences. With `-U`, each becomes a 10-byte `#L7fffffff`, but `wide_to_local_string()` reserved 8 bytes an escape (`MAX_ESCAPE_BYTES`), and its `-U` arm appended with `strcat()`: Debian's CVE-2022-0529 fix bounded only the other arm. `utf8.mjs`'s `six.zip` holds a bit-11 name of 24 such sequences (`fd bf bf bf bf bf`) and `ok.txt`. The 3.0.0-3 recipe without this patch (every other patch applied), and the published 3.0.0-2, fail only lines 77–83:

```
FAIL utf8.mjs:77 | unzip -U -l six.zip: rc 70   (RuntimeError: memory access out of bounds)
FAIL utf8.mjs:79 | unzip -U -l shows every 31-bit character as #L7fffffff
FAIL utf8.mjs:81 | unzip -U -d six.zip: rc 70
```

With it, both list and extract `w#L7fffffff…#L7fffffff.txt` (24 escapes) and `ok.txt` with their bytes.

## 3.0.0-2 (homescoop#431, #432, #439, #440, #441)

**Date:** 2026-10-16, slicc-kernel 1.94.0 (`cert/meta.json`, users enforce), wasm-bash 5.3.0-18 and wasm-coreutils 9.12.0-7 installed for `cert/*.mjs`, nothing but wasm-zip for `cert/noshell/`. Local builds (macOS arm64, emsdk 4.0.23, `bash scripts/host-run.sh zip`): the 3.0.0-2 tarball passes every spec and `cert/noshell/`, also on slicc-kernel 1.100.4.

### Each patch removed

The 3.0.0-2 recipe, rebuilt with one patch left out (the other three applied):

| Left out | Fails | How |
| --- | --- | --- |
| `zip-split-copy.patch` | `split.mjs` | `unzip -tq of the merged 1m split: rc 2`, `error:  invalid compressed data to inflate r.bin` |
| `zip-stdout-seek.patch` | `stdout.mjs` | `unzip -t file.zip: rc 2`, `warning [file.zip]:  128 extra bytes at beginning or within zipfile` |
| `zip-test-failed-fclose.patch` | `ztest.mjs` | `zip -T -TT false: rc 70`, `test of bad.zip FAILED` then `Aborted(native code called abort())` |
| `zip-test-spawn.patch` | `ztest.mjs`, `noshell/ztest.mjs` | `zip -T "it's $HOME.zip": rc 8` with `sh: -c: line 1: unexpected EOF while looking for matching '''`; with no shell, `zip -T: rc 8` |

Every other spec passes in each of these builds.

### The published 3.0.0-1, and main's build.sh

`@ai-ecoverse/wasm-zip@3.0.0-1` (npm) and main's build.sh with only unzip's link line fixed (`LF2`, so it builds after #459; no patches, no Unicode flags, no `SOURCE_DATE_EPOCH`) fail the same specs. `roundtrip.mjs` passes on both.

- `options.mjs`: `zip -v lists UNICODE_SUPPORT`. With `--soft` also: unzip has no `UNICODE_SUPPORT` or `MBCS-support`, and both print `Compiled ... on Sep 28 2026.` (3.0.0-1) or the day of the build (`on Oct 16 2026.`) instead of `on Apr 20 2009.` (#441).
- `utf8.mjs`: `unzip -l shows café.txt`. It lists `caf??.txt`, `??n??/??????.txt`, and the CP437 name with a Unicode Path extra field as `na?ve.txt`. `--soft` shows the rest:
  - `out/naïve.txt: No such file or directory`. unzip ignores the extra field and creates the CP437 name, which isn't UTF-8: Emscripten logs `Invalid UTF-8 leading byte 0x0000008b`, and the file gets a mangled name;
  - `naïve.txt: UTF-8 flag (bit 11) 0 !== 2048`, the same for `ü/` and `ü/名.txt`.
  - The UTF-8-flagged names do extract under their names with their bytes. On this kernel the "Is a directory" failure of #431 (slicc-kernel#756) does not reproduce, with these builds or with 3.0.0-1.
- `stdout.mjs`: `unzip -t file.zip: rc 2`, `128 extra bytes at beginning or within zipfile` (#439).
- `split.mjs`: `unzip -tq of the merged 1m split: rc 2`, `invalid compressed data to inflate r.bin` (#440).
- `ztest.mjs`:
  - 3.0.0-1: `zip -T: rc 70`, `unzip pipe error: Function not implemented`, then `RuntimeError: null function`;
  - main's build: `zip -T -TT false: rc 70`;
  - main's build without a shell (`cert/noshell/`): `zip -T: rc 8`, `unzip pipe error: No such file or directory` (#432).

### Empty wasm

```
browser-cert: FAIL packages/zip/cert/options.mjs (crash at packages/zip/cert/options.mjs:3)
Error: Error: WebAssembly.compile(): BufferSource argument is empty
browser-cert: FAIL packages/zip/cert/roundtrip.mjs (crash at packages/zip/cert/roundtrip.mjs:10)
browser-cert: FAIL packages/zip/cert/split.mjs
browser-cert: FAIL packages/zip/cert/stdout.mjs
browser-cert: FAIL packages/zip/cert/utf8.mjs (crash at packages/zip/cert/utf8.mjs:21)
browser-cert: FAIL packages/zip/cert/ztest.mjs (crash at packages/zip/cert/ztest.mjs:15)
prove-negative: ok — cert failed on bad zip tarball (status 1)
```

### The causes

- **#439** is Emscripten's libc, not the kernel. Its `stdout` FILE has a seek hook that returns 0 and moves nothing (`__emscripten_stdout_seek` in `musl/src/stdio/stdout.c`). So zip's `is_seekable()` takes any stdout for a seekable file, a pipe too. Each local header "rewritten" after its data then lands at the end of the stream. `lseek(1, …)` through the kernel is right: EINVAL on a file at 0, ESPIPE on a pipe. The patch writes through `fdopen(1)`, whose seek is `lseek`.
- **#440** is upstream zip 3.0, and macOS's `/usr/bin/zip` 3.0 does the same: `zip -s 64k` then `zip -s 0 --out` corrupts the archive there too. `bfcopy()` opens the next split only when a read sees EOF. When an entry's bytes on a split end exactly on a 16 KiB read (`CBSZ`), the next read returns 0 and the copy stops short. That happens on every middle split of a 1m or 64k split. The parts zip -s writes in seven match macOS's byte for byte, apart from the timestamps and owner ids, and macOS's zip -s 0 of seven's parts fails the same way.
- **#432**: zip -T ran `unzip -v` with `popen()` and `unzip -t -qq 'name'` with `system()`, both through `/bin/sh`. Without a shell that fails, and a name with a quote breaks the command line even with one. The patch spawns unzip with an argv. A failed test then crashed: `bfwrite()` keeps the output in `current_local_file`, and `ziperr()` closed it a second time (upstream).

## 3.0.0-1 (#429)

**Date:** 2026-10-15, slicc-kernel 1.94.0 (users enforce), against the ladder-pr artifact of #429 (`host-zip-pr429`, package.tgz sha256 `0ea3f809cf92d606d5a5297207be068a6f22b683baac39e3cf1f5168cb01e54b`, version 3.0.0-1). This is the first cert/ for zip (homescoop#426), so zip isn't in `scripts/ci-certified.json`.

### Empty wasm

```
browser-cert: FAIL packages/zip/cert/options.mjs (crash at packages/zip/cert/options.mjs:3)
Error: Error: WebAssembly.compile(): BufferSource argument is empty
browser-cert: FAIL packages/zip/cert/roundtrip.mjs (crash at packages/zip/cert/roundtrip.mjs:10)
Error: Error: WebAssembly.compile(): BufferSource argument is empty
prove-negative: ok — cert failed on bad zip tarball (status 1)
```

### The build before #429

main's `build.sh` (at 57e6ab5d … bd70917c) builds nothing:

```
unix/unix.c:11:10: fatal error: 'zip.h' file not found
```

With only `-I.` added, unzip doesn't compile under clang 22: `call to undeclared function 'isatty'` and `'unlink'`, from `unzip.c` and `fileio.c`.

With `-I.` and the unzip fixes, but without zip's configure-equivalent flags (`-DLARGE_FILE_SUPPORT -DZIP64_SUPPORT …`), the package builds, and both specs fail at zip's first run:

```
browser-cert: FAIL packages/zip/cert/options.mjs
AssertionError [ERR_ASSERTION]: zip -v: rc 19
browser-cert: FAIL packages/zip/cert/roundtrip.mjs
AssertionError [ERR_ASSERTION]: zip -r: rc 19
zip error: Not supported (uzoff_t not same size as zoff_t)
```

### The specs aren't vacuous

- `options.mjs`: `zip -v` and `unzip -v` must name Zip 3.0 and UnZip 6.00 and list LARGE_FILE_SUPPORT, ZIP64_SUPPORT and the rest of the published 3.0.0-1's options. A build without the flags fails, as shown above.
- `roundtrip.mjs` runs as the user cone (users enforce):
  - `zip -r` compresses a tree with a nested dir and a 64 KiB file;
  - `unzip -l` must list every entry with the 65536 size;
  - `unzip -t` must report no errors;
  - `unzip -p` must return the exact bytes;
  - `unzip -d` must extract identical files;
  - a missing archive must give rc 9 and `cannot find or open`.
