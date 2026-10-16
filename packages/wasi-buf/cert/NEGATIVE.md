# Negative proof (wasi-buf cert/, homescoop#488)

**Date:** 2026-10-16. `cert/checklist.mjs` ran on slicc-kernel 1.94.0 with users enforce, against `buf.wasm` built by `build.sh` on macOS arm64 with one patch left out and swapped into the published 1.73.0-2 tarball. The runs used `--soft`, which records every failed assertion. The full series passes.

## Without 0002 (format -d without exec)

buf runs `diff -u` for `format -d`. seven has no diff, so every format case fails:

```text
checklist.mjs:78  rc=1 Failure: exec: "diff": executable file not found in $PATH   (1 !== 100)
checklist.mjs:82  format -w: rc=1 … (1 !== 0)
```

## Without 0005 (the host module)

buf has no way to start commands or open connections. The HTTP input and generate fail, and none of the four generated files is written:

```text
checklist.mjs:99   ls-files http://files.test/image.binpb: Failure: Get "http://files.test/image.binpb": proxyconnect tcp: dial tcp 127.0.0.1:3128: … connect: Connection refused
checklist.mjs:106  missing.binpb: no 'got HTTP status code 404' (the same connect error)
checklist.mjs:115  generate: Failure: plugin protoc-gen-go: exec: "protoc-gen-go": executable file not found in $PATH
checklist.mjs:117–122  pet.pb.go, kind.pb.go, pet_grpc.pb.go, pet.connect.go: empty
```

## 0001 and 0003

Without them, buf doesn't compile for wasip1 at all. 0001 is needed for the unix-only files. 0003 is needed because moby's client uses `syscall.RawSockaddrUnix` and `syscall.ForkLock`. 0003's runtime case is `beta registry plugin push`, which fails with `buf on wasip1 cannot reach a Docker engine`.

## Empty wasm (spec not vacuous)

`prove-negative.mjs --package wasi-buf`: `cert failed on bad wasi-buf tarball` (`WebAssembly.compile(): BufferSource argument is empty`).
