# Negative: patches/0001 (speed's loops watch the clock)

The kernel delivers a signal to a WASIX program at its next system call.
`openssl speed` stops each measurement with `alarm()` and a `SIGALRM`
handler that clears `run`, and its loops make no system call, so without
0001 the handler never runs and the first measurement never ends.

The same configuration built from the unpatched tree (3.5.9's
`apps/speed.c`), on slicc-kernel 1.186.0's Node entry, `createNodeKernel()`:

```text
$ timeout 20 openssl speed -seconds 1 -bytes 1024 sha256; echo "rc=$?"
Doing sha256 ops for 1s on 1024 size blocks:
rc=124
```

The command printed its first line and nothing more until `timeout` killed it
after 20 s (22 s in all). With 0001, test/kernel.mjs's `speed ends on its own`
case runs `speed -seconds 1 -bytes 1024 sha256` and `speed -seconds 1 -elapsed
ecdsap256` in about 3 s together, in both runtimes, and cert/checklist.mjs
runs the first in the browser.
