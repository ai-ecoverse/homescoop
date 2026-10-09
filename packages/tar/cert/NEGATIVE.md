# Negative proof (tar)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`. Runs on slicc-kernel 1.26.6
(Node entry).

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
