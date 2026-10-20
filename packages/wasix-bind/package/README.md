# @ai-ecoverse/wasix-bind

BIND 9.20's `dig`, `host` and `nslookup` for [slicc](https://github.com/ai-ecoverse/slicc)'s
kernel, built for WASIX from ISC's sources. Recipe:
[homescoop/packages/wasix-bind](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-bind).

```sh
host example.com 100.100.100.100
host -t mx example.com 100.100.100.100
dig +short @100.100.100.100 example.com
dig -x 1.1.1.1 @100.100.100.100
nslookup example.com 100.100.100.100
```

## Transport

These are BIND's own tools, so they speak DNS over UDP and TCP to port 53,
and nothing else. This build has no DNS over HTTPS (BIND's DoH needs
nghttp2), so it does not replace `@ai-ecoverse/wasi-dig` on a machine
without a resolver it can reach.

- **UDP** reaches the network only through an uplink that carries UDP.
  When it can't (setting up or sending fails with "network unreachable"),
  the query is
  asked again over TCP at once, and dig prints
  `;; UDP network unreachable, retrying in TCP mode.` (the patch in
  `patches/`). Upstream BIND would wait for the read to time out instead.
  That includes `dig +nssearch`, both for the NS query and for each
  server's SOA query (homescoop#1379).
- **TCP** to port 53 reaches a resolver through the uplink, such as
  Tailscale's `100.100.100.100`, or one on the kernel's loopback.
- **No server argument** means the `nameserver` lines in `/etc/resolv.conf`.
  **On slicc-kernel ≥ 1.137.0** the kernel writes `nameserver 127.0.0.53`
  there and answers DNS itself. So `host <device>.slicc.internal`,
  `dig host.slicc.internal` and `nslookup <name>` work with no server
  argument: the kernel answers `/etc/hosts`, `localhost`, `host.slicc.internal`
  and the uplink's names, and forwards the rest to the uplink's nameserver or
  its DNS over HTTPS endpoint (homescoop#1282). Older kernels (≥ 1.96.0, the
  `engines` floor) ship no such file. There BIND asks 127.0.0.1, where
  nothing listens, so pass a server (`@100.100.100.100`), or have root write
  one: `echo nameserver 100.100.100.100 > /etc/resolv.conf`.

## Not in this build

No `named`, `delv`, `rndc` or zone tools; no DoH (`+https`), no IDN
(libidn2), no readline in `nslookup`'s interactive mode, no GSS-TSIG.

Exit status is BIND's: dig is 0 with an answer (NXDOMAIN included), 1 for a
usage error and 9 when no server answers; host is 1 when the name isn't found.

Licences: BIND is MPL-2.0 (`LICENSE`); libuv, userspace-rcu, OpenSSL and
wasix-libc, which it links statically, are in `THIRD-PARTY-NOTICES.md` and
`licenses/`. Sources and patches: `SOURCES.md`, `patches/`.
