# `@ai-ecoverse/wasix-websocat`

[websocat](https://github.com/vi/websocat) 4.0.0-alpha3, the WebSocket client and server ("netcat for `ws://`"), built for [slicc](https://github.com/ai-ecoverse/slicc)'s kernel as a WASIX program. It's upstream's source, unmodified. The build patches only crate wiring and the WASIX fork of mio; see the recipe.

```bash
pnpm add -g @ai-ecoverse/wasix-websocat
websocat -s 8080 mirror:                 # an echo server on the kernel loopback
echo hi | websocat ws://127.0.0.1:8080/  # hi
websocat -b ws://127.0.0.1:8080/ < file  # binary messages
```

Needs slicc-kernel 1.95.0 or later (WASIX epoll and eventfd, slicc-kernel#674).

## Networking

websocat v4 opens its own TCP connections and does its own TLS, with rustls and the bundled Mozilla roots (webpki-roots), so `wss://` needs no CA setup. It has **no HTTP or SOCKS proxy support**, so it never goes through the kernel's `https_proxy`.

- **Kernel loopback** (`127.0.0.1`, `localhost`) always works.
- **Other hosts** (`ws://example.com/`, `wss://…`) need an exit that gives programs raw TCP: in seven, a linked slicc CLI or a Tailscale exit node (the kernel's uplink). Without one:
  - a name fails with `No such file or directory (os error 44)`;
  - an address fails with `Network unreachable`.
- **No TLS server:** websocat v4 can't serve `wss://`.
- **What the cert covers through an uplink:** `ws://` echo, and `wss://` with `-k`. That's the TLS handshake and framing against a throwaway CA. Chain verification uses the embedded webpki roots, and is covered by slicc-bios end to end.

websocat 4 is upstream's current line but still a pre-release: options and specifiers differ from websocat 1.x (see `websocat --help`; for example, there's no `-1`).
