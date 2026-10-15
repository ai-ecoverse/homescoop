# Negative proof (tar)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`. Runs on slicc-kernel 1.26.6
(Node entry).

## No process credentials (published 1.35.0-4, users enforce)

`users.mjs` on slicc-kernel 1.69.0 with users `enforce` (Node entry, 2026-10-13): 1.35.0-4 links the slicc shims from before #207, so `geteuid()` is Emscripten's fixed answer and root's tar acts as a non-root user. Root's plain `tar -xf` of an archive holding 1000:1000 640, 1000:1000 4755 and 1000:100 2755 gives:

```text
640 0:0 f640
755 0:0 g2755
755 0:0 s4755
```

(owners not kept, setuid/setgid dropped). 1.35.0-5 keeps `640 1000:1000`, `4755 1000:1000`, `2755 1000:100`. `scripts/check-slicc-cred.mjs` refuses a build like -4: tar.wasm exports `slicc_sig_mask` but does not import `slicc_cred_js`.

## Known-bad build: no fork

`build.sh` linking the `cli` shim profile instead of `fork` (built locally,
not committed). `fork()` is then Emscripten's ENOSYS stub, and the first
compressed archive fails:

```
tar -czf x.tgz -C src .: rc=2 stderr=tar: child process: Cannot fork: Function not implemented
```

## Old exec shim (published 1.35.0-3)

1.35.0-3 links the spawn + `execWait` exec shim, and **passes** this
checklist. tar's child execs once (`sh -c <program>`), and on 1.26.6 a
single exec already lands under the child's pid. The old shim loses the pid
only on exec chains within one image, which `shims/slicc/test/exec.test.mjs`
covers (#145). Here the compressor case is a regression guard: it must be
tar's direct child in `/proc`, and its status must reach tar.

## linkat and glue mode (1.35.0-6)

Against the published `@ai-ecoverse/wasm-tar` 1.35.0-5 (slicc-kernel 1.88.0,
2026-10-15), checklist.mjs and users.mjs pass, but linkat.mjs fails at its
first check:

```
browser-cert: FAIL packages/tar/cert/linkat.mjs
AssertionError [ERR_ASSERTION]: tar.wasm imports env.__syscall_linkat (the slicc shim beats libc's weak stub)
```

In 1.35.0-5, libc's weak stub answers EMLINK inside the wasm, so no kernel
could link. Its `bin/tar` glue is also 0644 (`-rw-r--r--`); host-run's
command-modes check refuses that for -6.

`glue-mode.mjs` (added after 1.35.0-6 was published, cert-only) against
1.35.0-5 on slicc-kernel 1.88.0 (users enforce): FAIL. `bin/tar` is 644 in the
tarball, so the first assertion (`755 …/bin/tar`) fails, and running it by
path as cone is refused with rc 126 (`Permission denied`), as coreutils
9.12.0-5 is. 1.35.0-6 installs both files 755 and runs by path.
