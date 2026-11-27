# `@ai-ecoverse/wasi-impeccable`

[Impeccable](https://impeccable.style) engine **0.1.28** for
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
impeccable --version   # prints the engine version (e.g. 0.1.28)
```

**Also wired:** `palette`, `doctor`, `ignores`, `pin`, `detect-csp`,
`surface-brief`, `critique-storage`, `audit-storage`, `embed-prompt`, `signals` /
`context-signals`, `context`, `comp-spec`, `comp-diff`, `hook` /
`hook-before-edit` / `hooks`, `foundations`, `design-compact`, `design-lookup`,
`font-fetch`, `switches`, and the skills verbs `help`, `link`, `update` and
`check`.

**Sampled contrast** (since 0.1.27): `detect` measures text over a local or
data-URI `background-image` against the image's pixels, decoded in the
engine, and caches the samples under `~/.impeccable/sample-cache/`, which the
edit hook reads. `detect --sarif` (since 0.1.27) writes a SARIF 2.1.0 log,
and `detect --report-unused-ignores` lists inline waivers that waived
nothing. `design-compact` (since 0.1.27) proposes a long DESIGN.md as the
map `context` carries and, with `--write`, moves the original to
`.impeccable/design-full.md`; `design-lookup <term>` finds a token or
section in either. `font-fetch "<Family>"` (since 0.1.27) downloads a
Google font's latin and latin-ext WOFF2 files into the project through the
kernel's proxy and prints their `@font-face` rules. `switches` (since 0.1.27)
lists the Impeccable lines in each agent's user-level rule file;
Cursor's per-repository rule needs `git`, so without it in the kernel
there is no Cursor line.

**Wiring check** (`impeccable detect --before page.html`, then `--kept`,
since 0.1.25) records each static HTML file's links, forms, fields, buttons,
handlers, ids, test hooks, scripts and label targets under the project's
`.impeccable/wiring/`, and fails when a redesign dropped one.
`detect --changed` (since 0.1.25) asks `git` for the changed UI files when
the kernel has it; without it, it refuses as it does outside a git work tree.
`loop connect --mcp-only` (since 0.1.25) adds the Impeccable MCP server to
Claude Code's or Codex's own configuration, as upstream does on any OS. It
adds it through the agent's CLI, which this build can't start, so here it
finds a server already there or reports the agent as not connected.
Cursor, GitHub Copilot CLI and opencode (since 0.1.28) get the server from
the engine itself: it writes `~/.cursor/mcp.json`, `~/.copilot/mcp-config.json`
(`COPILOT_HOME`) or `~/.config/opencode/opencode.json` (`XDG_CONFIG_HOME`),
keeps what else is in the file, and journals the change, so
`impeccable agents undo` restores the file byte for byte. That works here
for Copilot and opencode. Cursor then runs `cursor-agent mcp enable
impeccable`, which this build can't start, so Cursor is reported as not
connected with its entry written. An opencode with only an
`opencode.jsonc` gets the line to add by hand, and nothing is written.

**Foundations** (`impeccable foundations [path] [--json]`, since 0.1.24)
checks the product foundations the project's files show (secrets in the
repository, giant files, CI that runs the tests, dependency scanning, icons,
legal pages and more) and runs the same scan as `detect` for its contrast and
generic-AI-pattern items. It lists the files to scan for secrets with
`git ls-files` when the kernel has `git`; without it, a folder outside a git
work tree is walked instead, and inside one the secrets item is left
unchecked. The roadmap is never uploaded. `context` prints the taste block
from a cached `~/.impeccable/taste.json` as upstream does; this build never
fetches one.

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
`setup`, `critiques` since 0.1.23, `world`, `taste-refresh` since 0.1.24,
`status` since 0.1.25, and `mcp` and `switches-refresh` since 0.1.27.
`motion-capture` (since 0.1.25), `first-viewport` and `shot` (since 0.1.27)
drive a Chrome and refuse the same way, and so do `agents running`
(since 0.1.27), which lists the sessions `mcp` records, and `walkthrough`
(since 0.1.24), which needs the system's ffmpeg. `install` registers no
browser relay and offers no sign-in, and `context` prints no `ACCOUNT:`
line, so the skill never suggests a sign-in. Without sign-in, `detect` never
uploads a design health scan and never hands a scan to Impeccable Pro,
`critique-storage` saves a critique locally and never uploads it, and no
setup report is sent. `loop install` refuses as upstream does off macOS,
and so do `loop connect` and `loop disconnect` since 0.1.23 and
`loop status` since 0.1.24. Use
upstream [`impeccable`](https://www.npmjs.com/package/impeccable) /
[pbakaus/impeccable](https://github.com/pbakaus/impeccable) for those.
