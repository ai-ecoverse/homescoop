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

## 9.20.29-2: dig +nssearch over TCP (homescoop#1379; 2026-10-20)

`checklist.mjs` on npm's `@ai-ecoverse/wasix-bind@9.20.29-1` (slicc-kernel 1.134.3, users enforce) fails 8 of 98 assertions. That count includes the #1370 unrouted-resolver row added after -1. The new rows fail as follows:

- `dig +time=2 +tries=1 +nssearch @100.100.100.100 nss.test` gives `;; NS servers could not be reached`, rc 9.
- `+tcp +nssearch` fails the same way.

There were two causes:

1. The patch skipped the TCP retry when `ns_search_only` was set.
2. Upstream's `send_done()` calls `nssearch_next()` after every NSSEARCH send. For the last (or only) query, `check_if_queries_done()` excludes that query, finds nothing else pending, and reports failure before its answer arrives. Over TCP the answer always arrives after the send. So even `+tcp +nssearch` (#1379's workaround) failed against a zone whose NS name resolves; #1379's own repro never got that far.

9.20.29-2 retries `+nssearch` over TCP, and calls `nssearch_next()` from `send_done()` only when there is a next query. This build passes checklist.mjs and users.mjs on the same kernel.

## 9.20.29-2: the kernel's DNS stub, no server argument (homescoop#1282; 2026-10-20)

The same 9.20.29-2 build on slicc-kernel 1.134.3 fails the no-server rows of `checklist.mjs` (19 of 116 assertions). `/etc/resolv.conf` doesn't exist there, and `host host.slicc.internal` is rc 1, because BIND asks 127.0.0.1, where nothing listens. On 1.137.0 (sk#1244, the stub on 127.0.0.53 and a default `/etc/resolv.conf`) all of checklist.mjs and users.mjs pass. The cert kernel moves to 1.137.0, and the harness passes the uplink's `nameserver` (`cert/meta.json` `"uplink": {"nameserver": "100.100.100.100"}`) so the stub forwards public names to the dnsFake. `engines` stays `>=1.96.0`, since an explicit server still works there.


## 9.20.29-3: dig +nssearch exits when the last NS query fails after another answered (homescoop#1475; 2026-10-21)

`checklist.mjs` on npm's `@ai-ecoverse/wasix-bind@9.20.29-2`, users enforce, `--soft`:

- slicc-kernel 1.143.4 (npm `latest`, the new `extra_kernels` entry): FAIL, 40 of 228 assertions;
- slicc-kernel 1.137.0 (the cert kernel): FAIL, 28 of 228 assertions.

Every failure is in the new `+nssearch` rounds. dig queries the NS servers in a random order, so the count varies from run to run. Each failing round printed the good server's SOA line and then hung until `timeout 10` killed it:

```text
nss2.test round 4: rc=124
SOA ns1.nss2.test. hostmaster.nss2.test. 2026102002 7200 3600 1209600 300 from server 100.100.100.100 in 1 ms.
;; Connection to 100.64.9.9#53(100.64.9.9) for nss2.test failed: connection refused.
nss2.test round 4 took 10065 ms
nss5.test round 2: rc=124   (100.64.9.10 never answers the dial: "failed: timed out." after +time=1)
```

The cause is upstream's `nssearch_next()` (`bin/dig/dighost.c`). When the last query in the list fails to connect (`tcp_connected()`, or `udp_ready()`), and an earlier server has already answered (`ns_search_success`), it only detaches the query and the lookup. The earlier answer's `clear_current_lookup()` had returned early ("still have a worker"). So nobody clears the lookup and dig never exits. 9.20.29-3 handles this the way `recv_done()` does for a failed read: once no other query is pending, it cancels and clears the lookup either way, and it reports "NS servers could not be reached" (rc 9) only if no server answered. The same build passes `checklist.mjs` and `users.mjs` on 1.137.0 and on 1.143.4, where every round takes 90–130 ms (refused) or about 1.1 s (the dial that doesn't answer, `+time=1`).

## 9.20.29-3: users.mjs sets up its own /etc/resolv.conf (homescoop#1476; 2026-10-21)

The 1.137 rows of #1476 were fixed in PR #1470 before 9.20.29-2 was published (head ef38c0d2: the no-server rows assert the kernel's `nameserver 127.0.0.53`). What was left: `users.mjs` asserted that `/etc/resolv.conf` was the kernel's default, so it passed only if `checklist.mjs` had run first and restored the file. On slicc-kernel 1.143.4, with a spec before it that leaves root's `nameserver 100.100.100.100` in `/etc/resolv.conf` (what a checklist crash inside its try block would leave), the -2 `users.mjs` fails 2 of 22 assertions:

```text
users.mjs:43: the kernel's default /etc/resolv.conf is unchanged: nameserver 100.100.100.100
```

The new `users.mjs` passes that same run. Root writes its own `/etc/resolv.conf`, alice can't overwrite it, alice's and bob's `dig` with no server use it, and root then puts the previous file back. `checklist.mjs` now copies the kernel's file aside and restores it byte for byte, where it used to re-type it with `printf`.
