# Negative proof (wasix-bind)

## 9.20.29-1: new package (homescoop#1282)

**Date:** 2026-10-20. slicc-kernel 1.134.3, users enforce, the cert uplink
(TCP, no UDP). New package, so it needs a human cert and is not in
`scripts/ci-certified.json`. The good build passes both specs on wasix-sysroot
2025.9.30-34 and on -39 (the recipe's pin); the mutant below is the -34 build.

## Empty wasm (spec not vacuous)

`prove-negative.mjs --users enforce` empties `bin/dig.wasm`, `bin/host.wasm`
and `bin/nslookup.wasm`: FAIL, 2 of 2 specs.

```text
Error: WebAssembly.compile(): BufferSource argument is empty
```

## Upstream dighost.c (no TCP retry when UDP can't leave)

The same build with `bin/dig/dighost.c` as ISC ships it, so only
`configure`'s static-build check is patched. `checklist.mjs --soft`: FAIL,
58 of 80 assertions. Every query without `+tcp` waits out its read timeout
and gives up:

```text
dig +tries=1 @100.100.100.100 example.test: rc=9
dig took 5068 ms
;; communications error to 100.100.100.100#53: timed out
TCP dial to the tailnet resolver                       (no dial in the uplink log)
dig +short @100.100.100.100 example.test MX: rc=9
host example.test 100.100.100.100: rc=1
```

The `+tcp`, `-v`/`-V`/`-version`, refused-server and bad-option cases pass on
both builds; `users.mjs` (dig over UDP-then-TCP, host) fails on it too.

## The send-only retry (#1370)

The PR's first build retried over TCP only when the UDP *send* failed. For an
address no uplink routes, UDP already fails at setup. That build against
this checklist: FAIL, 3 of 89 assertions, all of them in the unrouted case:

```text
dig +tries=1 @192.0.2.53 example.test
;; UDP setup with 192.0.2.53#53(192.0.2.53) for example.test failed: network unreachable.
;; no servers could be reached          (no TCP retry)
```
