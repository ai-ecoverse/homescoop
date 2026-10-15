# Negative proof (bzip2)

## bzip2recover aborts at EOF (published 1.0.8-1)

`checklist.mjs` on slicc-kernel 1.69.0 (Node entry, 2026-10-13). Upstream prints block offsets with `MaybeUInt64_FMT "%Lu"`, a long-double length modifier that musl's printf rejects for an integer: the call fails with errno `EINVAL`. `bsGetBit` takes any nonzero `errno` at EOF for a read error, so 1.0.8-1 prints empty offsets and gives up without writing a file:

```text
bzip2recover: searching for block boundaries ...
   block 1 runs from    block 2 runs from    block 3 runs from bzip2recover: I/O error reading `data.bz2', possible reason follows.
bzip2recover: Invalid argument
bzip2recover: warning: output file(s) may be incomplete.
```

1.0.8-2 applies `bzip2recover-llu.patch` (`"%llu"`, as Debian and Fedora do) and writes `rec00001data.bz2` … `rec00003data.bz2`.
