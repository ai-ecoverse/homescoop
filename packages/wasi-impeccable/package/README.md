# `@ai-ecoverse/wasi-impeccable`

[Impeccable](https://impeccable.style) engine **0.1.12** for
[slicc](https://github.com/ai-ecoverse/slicc)'s WASI preview1 realm
(`abi: "wasi"` — module only, no Emscripten glue).

**File-local verbs** (no network, Chrome, or live server in this build):

```bash
pnpm add -g @ai-ecoverse/wasi-impeccable
impeccable detect path/to/page.html
impeccable detect src/
impeccable palette
impeccable doctor
impeccable hooks status
impeccable --version   # prints the engine version (e.g. 0.1.12)
```

Also wired: `ignores`, `pin`, `detect-csp`, `surface-brief`, `critique-storage`,
`embed-prompt`, `signals` / `context-signals`, `context`, `comp-spec`,
`comp-diff`, `hook` / `hook-before-edit` / `hooks`, and the skills verbs
`help` / `link` / `check` (and `install` / `update` entry points). Paths that
need network, process spawn, listening sockets, or a browser refuse with
`not available in this build yet` instead of `Unknown command`.

URL / Chrome scans, live mode, `generate-image`, and `concept-seed` stay on
upstream [`impeccable`](https://www.npmjs.com/package/impeccable) /
[pbakaus/impeccable](https://github.com/pbakaus/impeccable) until a later cut
puts them on WASIX networking.
