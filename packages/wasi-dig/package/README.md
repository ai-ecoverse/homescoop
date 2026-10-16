# @ai-ecoverse/wasi-dig

`dig` for [slicc](https://github.com/ai-ecoverse/slicc)'s kernel: DNS lookups with
dig's output, as a WASI command (wasm32-wasip1). Source and recipe:
[homescoop/packages/wasi-dig](https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasi-dig).

slicc's kernel has no UDP, so queries go another way:

| server | transport |
| --- | --- |
| none | DNS over HTTPS (RFC 8484) to `$DIG_DOH_URL`, else `https://cloudflare-dns.com/dns-query`, through the realm proxy |
| `@https://host/path`, `+https=URL` | DNS over HTTPS to that endpoint |
| `@host` (`-p port`) | DNS over TCP to host:53, e.g. a tailnet resolver (`@100.100.100.100`) through the uplink |

```sh
dig example.com
dig +short mx example.com
dig -x 1.1.1.1 +short
dig +noall +answer txt example.com
dig @https://1.1.1.1/dns-query example.com AAAA
dig +short dnskey cloudflare.com
dig https cloudflare.com
dig @100.100.100.100 my-host.tailnet.ts.net
```

In a browser, the realm proxy can reach only DoH endpoints that allow
cross-origin requests. cloudflare-dns.com and 1.1.1.1 do; dns.google doesn't, and dig
reports `HTTP 502` with a hint.

Types: every mnemonic BIND knows, and `TYPEnnn`. Records print as BIND's dig
prints them: its columns, DNSSEC records (DNSKEY, DS, RRSIG, NSEC, NSEC3,
NSEC3PARAM) in RFC 4034 presentation format, HTTPS/SVCB with BIND's SvcParams
and unknown types as RFC 3597's `\# <length> <hex>`. Options: `+short`,
`+[no]all`, `+[no]cmd`, `+[no]comments`, `+[no]question`, `+[no]answer`,
`+[no]authority`, `+[no]additional`, `+[no]stats`, `+[no]recurse`,
`+[no]edns`, `+[no]dnssec`, `+[no]adflag` (on by default, as in dig),
`+[no]cdflag`, `+[no]crypto`, `+time=N`, `+tries=N`, `+tcp`. `+notcp` is
refused (no UDP).

Exit status: 0 with an answer (NXDOMAIN included), 1 for a usage error, 9 when
no server answers.

Not dig: no UDP, no `-f` batch files, no `+trace`, no TSIG, no zone transfers.
Licences of the linked crates, Rust's standard library and wasi-libc are in
`THIRD-PARTY-NOTICES.md`.
