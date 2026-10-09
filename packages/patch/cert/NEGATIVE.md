# Negative proof (patch)

**Date:** 2026-10-09
No patches. Not in `scripts/ci-certified.json`. Runs on slicc-kernel 1.26.6
(Node entry).

## Known-bad build: the published 2.8.0

2.8.0 applies patches correctly, but it ships homescoop's Apache-2.0 text as
LICENSE (the committed stub, #123). The checklist fails on the package's own
files:

```
LICENSE is not GPL-3: "                                 Apache License\n   …Version 2.0, January 2004\n"
```

## Spec non-vacuous

Every case compares the exit status, stdout and stderr exactly, including
the `.rej` contents and the `.orig` backup.
