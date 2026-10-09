# Negative proof (diffutils)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`. Runs on slicc-kernel 1.26.6
(Node entry).

## Known-bad build: the published 3.12.0

3.12.0 linked the `cli` shim profile as plain LDFLAGS (no fork, and not
whole-archive), so `execve`/`posix_spawn` were Emscripten's stubs. diff and
cmp work, but the checklist fails at sdiff, and diff3 fails the same way:

```
sdiff -w 30 x y: rc=2 stderr=sdiff: diff: Exec format error
diff3: fork: Function not implemented
```

3.12.0-1 links the `fork` profile (Asyncify) through
`homescoop_slicc_link_archive`, so both run diff as a child.

## Spec non-vacuous

Every case compares the exit status and the exact output against GNU
diffutils 3.12 run on the host.
