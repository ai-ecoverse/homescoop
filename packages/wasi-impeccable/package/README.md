# `@ai-ecoverse/wasi-impeccable`

[Impeccable](https://impeccable.style) engine **0.1.24** for
[slicc](https://github.com/ai-ecoverse/slicc)'s WASI preview1 realm
(`abi: "wasi"`: a module only, no Emscripten glue).

```bash
pnpm add -g @ai-ecoverse/wasi-impeccable
impeccable detect path/to/page.html
impeccable detect src/
impeccable install --providers=claude -y   # downloads and verifies the signed skill bundle
impeccable check
impeccable generate-image --prompt "…" --out comps/hero.png   # needs OPENAI_API_KEY
impeccable concept-seed --scope surface
impeccable --version   # prints the engine version (e.g. 0.1.24)
```

**Also wired:** `palette`, `doctor`, `ignores`, `pin`, `detect-csp`,
`surface-brief`, `critique-storage`, `audit-storage`, `embed-prompt`, `signals` /
`context-signals`, `context`, `comp-spec`, `comp-diff`, `hook` /
`hook-before-edit` / `hooks`, and the skills verbs `help`, `link`,
`update` and `check`.

**HTTP** goes through the proxy that slicc's kernel names in `https_proxy`.
The kernel does the TLS, so this build carries no TLS stack. Loopback and
`NO_PROXY` hosts skip the proxy, as upstream; with no TLS here, that works for
`http://` only. Skill-bundle signatures are verified with `ed25519-dalek`
instead of `ring` (which does not build for WASI), against the same Ed25519
keys compiled into the engine. Relative
paths resolve against the directory the command runs in; `PWD` names it only
when it is that directory, so a stale one (as Node's `spawn` with `cwd` leaves
it) is ignored. 0.1.18-1 and earlier took `PWD` as it was.

**Live mode** (`impeccable live`, `live-poll`, `live-server`, …) runs its
server detached on the kernel's loopback; the engine is built for
`wasm32-wasip1-threads` for it. Other kernel processes, such as the agent's
`live-poll`, reach it. A page in slicc cannot reach it yet: that needs
slicc-kernel's `dial` (slicc-kernel#103) and slicc-bios routing
`localhost:<port>` to it (slicc-bios#92). Svelte live sessions need node and
refuse.

**Deeply nested markup is slow** (homescoop#620). That's upstream engine
behaviour: each element's checks walk its ancestors, so `detect` costs
elements × depth. 1000 nested elements take 1–2 s and 2000 4–8 s,
but 4000 take about 40 s and 8000 several minutes (a native build: 15 s and
83 s). Real pages rarely nest past a few hundred; generated markup can.

**Not in this build:** URL / Chrome scans, `detect --cdp` (attaching to a
running app's DevTools port), `serve-question` and the capture verbs refuse
with `not available in this build yet` instead of `Unknown command`, and so
do the account verbs: `login`, `logout`, `whoami`, `health` since 0.1.22,
and `setup`, `critiques` since 0.1.23. Without sign-in, `detect` never
uploads a design health scan and never hands a scan to Impeccable Pro,
`critique-storage` saves a critique locally and never uploads it, and no
setup report is sent. `loop install` refuses as upstream does off macOS,
and so do `loop connect` and `loop disconnect` since 0.1.23. Use
upstream [`impeccable`](https://www.npmjs.com/package/impeccable) /
[pbakaus/impeccable](https://github.com/pbakaus/impeccable) for those.
