# `@ai-ecoverse/wasi-impeccable`

[Impeccable](https://impeccable.style) engine **0.1.12** for
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
impeccable --version   # prints the engine version (e.g. 0.1.12)
```

**Also wired:** `palette`, `doctor`, `ignores`, `pin`, `detect-csp`,
`surface-brief`, `critique-storage`, `embed-prompt`, `signals` /
`context-signals`, `context`, `comp-spec`, `comp-diff`, `hook` /
`hook-before-edit` / `hooks`, and the skills verbs `help`, `link`,
`update` and `check`.

**HTTP** goes through the proxy that slicc's kernel names in `https_proxy`.
The kernel does the TLS, so this build carries no TLS stack. Skill-bundle
signatures are verified with `ed25519-dalek` instead of `ring` (which does not
build for WASI), against the same Ed25519 keys compiled into the engine. Relative
paths resolve against the directory the command runs in (`PWD`).

**Live mode** (`impeccable live`, `live-poll`, `live-server`, …) runs its
server detached on the kernel's loopback; the engine is built for
`wasm32-wasip1-threads` for it. Other kernel processes, such as the agent's
`live-poll`, reach it. A page in slicc cannot reach it yet: that needs
slicc-kernel's `dial` (slicc-kernel#103) and slicc-bios routing
`localhost:<port>` to it (slicc-bios#92). Svelte live sessions need node and
refuse.

**Not in this build:** URL / Chrome scans, `serve-question` and the capture
verbs refuse with `not available in this build yet` instead of
`Unknown command`. Use upstream
[`impeccable`](https://www.npmjs.com/package/impeccable) /
[pbakaus/impeccable](https://github.com/pbakaus/impeccable) for those.
