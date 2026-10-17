# Negative proof (wasi-dig)

## 0.1.0-4: the root rule, #573/#574/#599, users enforce (#864, #819)

**Date:** 2026-10-17.

**Supply chain.** cert-review's root rule (`scripts/cert-review/repack-input.mjs`):
- 0.1.0-3 (npm latest before this) is **not attested**: its recipe had no
  `source:` (sha none), and its build fetched rustup through `curl sh.rustup.rs`
  and `rustup toolchain install`, which no pinned sha256 covers.
- 0.1.0-4 at this head: `attested: true`, "builds its in-tree source (src,
  Cargo.toml, Cargo.lock), downloads nothing unpinned and can't stage a
  prebuilt". Rust 1.98.1 comes from `scripts/install-rust.sh` (rustc, cargo
  and rust-std from static.rust-lang.org by sha256, checked against
  `channel-rust-1.98.1.toml`); crates come through `cargo … --locked`.

**Behaviour.** The published 0.1.0-3 against this checklist on slicc-kernel
1.102.6, users enforce, `--soft`: `checklist.mjs` fails 18 cases, and passes
all the older ones. `users.mjs` passes on both, since dig itself opens no files:

```text
DoH 502, doh.test/cors          no "may be offline" wording
DoH 502, cloudflare-dns.com     '(the DoH endpoint may not allow cross-origin requests …; cloudflare-dns.com does)'  (#573)
DoH 502, 1.1.1.1                the same CORS hint                                                     (#573)
-t NULL null.test (rdlength 0)  rc 9 ';; Got bad packet: unexpected record with length 0 in non-update message'  (#574)
-t TYPE999, rdlength 0          the same bad packet                                                    (#574)
DNSKEY / DS with no key/digest  'emptykey.test.\t\t3600\tIN\tDNSKEY\t257 3 13 ' (trailing space)          (#574)
-t UID uid.test                 rc 1 'dig: invalid type: UID'                                          (#599)
RRSIG expiration 0xffffffff     '21060207062815'                     want '19691231235959'                 (#599)
```

An empty A record is still a bad packet on both.
`prove-negative.mjs --users enforce` (empty `bin/dig.wasm`): FAIL, 2 of 2 specs.

## 0.1.0-3 and earlier

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
