# Negative proof (wasi-dig)

**Date:** 2026-10-10 (0.1.0-1)
New package, so it needs human cert first and is not in `scripts/ci-certified.json`.

`cert/checklist.mjs` was run on slicc-kernel 1.32.0's Node entry with `UPLINK=1`,
with the same transport traits and uplink peers as `scripts/browser-cert/page/page.js`.
The good build passes in about 0.6 s. The mutant below was the good source with one
change, built with the same toolchain (Rust 1.98.1, wasm32-wasip1).

## Empty wasm (spec not vacuous)

`bin/dig.wasm` truncated to 0 bytes, as `prove-negative.mjs` does:

```text
CompileError: WebAssembly.compile(): BufferSource argument is empty
```

## DNS over TCP without the length prefix

`transport.rs` sends the query without RFC 1035's two-byte length. The uplink
peer waits for a complete frame and never answers:

```text
AssertionError [ERR_ASSERTION]: dig @100.100.100.100 host.tailnet.test: rc=9 stderr=;; communications error to 100.100.100.100#53: 100.100.100.100:53: socket timed out
;; no servers could be reached
```

## 0.1.0-2: hickory's presentation, no AD flag (homescoop#177, #403)

**Date:** 2026-10-16 (0.1.0-3). The published 0.1.0-2 against the 0.1.0-3 checklist, on slicc-kernel 1.81.0 with `--soft`. It fails every new case, and passes all the older ones:

```text
flags (signed.test)        'qr rd ra'                                   want 'qr rd ra ad'
long owner, answer         '<owner>.\t300\tIN\tA\t192.0.2.20'             want '<owner>. 300 IN\tA 192.0.2.20'
long owner, question       ';<owner>.\tIN\tA'                             want ';<owner>. IN A'
+short dnskey              'AQEDDZnbLMFMq9wz1td9pjovFfcR…ihk='           want '257 3 13 mdsswUyr…F+ KkxLbx…GQ=='
+short rrsig signed.test   rc=1 'dig: invalid type: signed.test'          (RRSIG/NSEC/NSEC3/NSEC3PARAM weren't type words)
+short https https.test    '1 . alpn=h2,'                                 want '1 . alpn="h2"'
+short -t TYPE999          'AQIDBA=='                                     want '\# 4 01020304'
TYPE999 question/answer    ';unknown.test.\t\t\tIN\tUnknown' …\tUnknown\tAQIDBA==
DoH 502                    'HTTP 502 from https://doh.test/cors'          (no CORS hint)
```
