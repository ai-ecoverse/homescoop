# Negative proof (wasi-impeccable)

**Date:** 2026-10-08 (0.1.12-4); 0.1.12-5 the same day

## Empty wasm (spec not vacuous)

`prove-negative.mjs --package wasi-impeccable` → FAIL
(`WebAssembly.compile(): BufferSource argument is empty`).

## Patch reverted (0001-wasi-cli.patch)

Remove `packages/wasi-impeccable/0001-wasi-cli.patch` and run
`bash scripts/host-run.sh wasi-impeccable` against engine-v0.1.12.

**Result:** compile fails in the `socks` crate (pulled by `ureq` `socks-proxy`
via `impeccable-context`, which the patch keeps off the wasm target graph):

```text
error[E0599]: no method named `writev` found for struct `UdpSocket`
error[E0599]: no method named `readv` found for struct `UdpSocket`
error: could not compile `socks` (lib) due to 2 previous errors
```

## Non-root cwd (0.1.12-5)

0.1.12-4 took the working directory from `std::env::current_dir()`, which is
wasi-libc's and stays `/` in the kernel. Its `Io.cwd` joined relative paths
onto `/`. Checked against the published 0.1.12-4: `detect --json dirty.html`
from `/home/site` reports the finding as `/dirty.html`. The checklist's
non-root-cwd case asserts `/home/site/dirty.html`, so it fails without the
`PWD` fix in `crates/common/src/lib.rs`. It also checks that
`generate-image --out comps/fake.png` lands under the cwd, not `/`.

## HTTP verbs (0.1.12-5, test/e2e/http.test.mjs)

The e2e suite carries its own negatives. A zip with one byte flipped is
refused (digest), and so is a signature envelope with one hex digit changed
(`Bundle signature verification failed` from ed25519-dalek inside WASI).
Nothing is installed in either case, and `https://` without a proxy fails
with the no-TLS error.

**Good tarball:** CI artifact `@ai-ecoverse/wasi-impeccable@0.1.12-5`, with
`cert/checklist.mjs` under slicc-kernel@1.15.1 and test/e2e on its Node
entry.

## THIRD-PARTY-NOTICES.md names the wrong wasi-sdk (0.1.15-1, homescoop#472)

`cert/notices.mjs` against the published `@ai-ecoverse/wasi-impeccable@0.1.15-1` on
slicc-kernel 1.15.1:

```text
browser-cert: FAIL packages/wasi-impeccable/cert/notices.mjs
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+   "## wasi-libc (wasi-sdk-31; Rust's self-contained wasm32-wasip1-threads libc)"
-   "## wasi-libc (wasi-sdk-33; Rust's self-contained wasm32-wasip1-threads libc)"
```

Rust 1.98.1 builds its self-contained wasm32-wasip1-threads libc with
`WASI_SDK_PATH=/tmp/wasi-sdk-33.0-x86_64-linux`. The four licence files are
the same at both tags, so only the heading and the URLs were wrong.
`scripts/check-rust-wasi-sdk.mjs` now checks the table against that
Dockerfile on every build.

## CARGO_HOME registry paths in impeccable.wasm (0.1.15-1, homescoop#471)

0.1.15-1 built without `--remap-path-prefix`, so the panic locations of the registry crates kept the runner's paths. `strings bin/impeccable.wasm` on the published 0.1.15-1 finds 203 of them (`/home/runner/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/regex-automata-0.4.18/…`, `zlib-rs-0.6.7`, `png-0.18.1`, …), so its bytes depend on where CARGO_HOME is. 0.1.15-3's host-path guard (`/Users/|/home/[^/]+/|/tmp/|/private/(tmp|var)/|/var/folders/|/rustup/`) matches all 203 and fails the build. The old guard (`/Users/[^/]+/Developer|/var/folders/`) matched none.

With the remap, two macOS builds with different CARGO_HOMEs (`~/.cargo` and a fresh `/tmp/…/cargo2`, which downloaded every crate again) and different work trees (`/tmp/…` and `~/.cache/…`) gave the same `impeccable.wasm` (sha256 `9d4eaf1e…`, 2026-10-16). It has 203 `/cargo/registry/…` paths and no host path.

## No telemetry verb (0.1.14-2, homescoop#482)

`cert/telemetry.mjs` on the published 0.1.14-2 (slicc-kernel 1.94.0, users enforce) fails at its first step:

```text
AssertionError [ERR_ASSERTION]: rc=1
--- stderr
Unknown command: "telemetry"
```

The spec doesn't pass vacuously. With its roll API inverted to demand the opposite header on opted-out rolls, it fails on 0.1.15-3 at the first opted-out roll: `SURFACE CONCEPT SEED (key: off-1; mode: unscoped; source: degraded; …)`.

## 0.1.15-5: the allocator refresh and the initial heap (homescoop#1287, 2026-10-20)

The published 0.1.15-4 passes the new stress row's traps check: 6 rounds over 600 pages, 0 traps on slicc-kernel 1.134.3. The trap is a V8 race (slicc-kernel#1172) at 5–12% of rounds under heavier allocation (azw9's canary, wasi-pnpm's loop), so the row is a guard, not a negative. 0.1.15-4's peak there was 49 MiB, hence the recorded 64 MiB initial heap, which the row checks.

## 0.1.15-6: the stress row's harness calls, deep markup, the allocator's cost (2026-10-20)

- **`cert/stress.mjs`** (homescoop#1363): 0.1.15-5's row ran each 600-page detect in one harness call, which on a slow runner passed 120 s ("Runtime.evaluate: no answer"). Since -6 detect runs detached and the spec polls it once a second. Locally, 4 runs (2 × -4, 2 × -5, alternated; slicc-kernel 1.134.3) all pass, with rounds of 17–45 s and no call near the limit.
- **homescoop#1364** (is the allocator refresh's realloc slower?): **not reproduced.** In those 12 rounds per version, the median detect is 27.5 s for 0.1.15-4 and 20 s for 0.1.15-5 (both noisy, 17–45 s), and output and traps (0) are the same. The refresh keeps realloc as alloc + copy + free on purpose: libc's realloc copies into a block it may have just taken from memory another thread grew, before the wrapper could refresh the view, and that copy is the trap.
- **`cert/deep.mjs`** (homescoop#620): upstream behaviour, documented, so -5 passes it too. On -5 here, 1000 and 2000 deep take 1.0 s and 3.8 s (2.1 s and 8.3 s on kernel 1.94.0 in the issue).


## 0.1.16-1: `detect --cdp` refuses on WASI (cert/cdp.mjs, 2026-10-27)

0.1.16 adds `detect --cdp <port|url>`, which attaches to a running Chromium-based app through its DevTools port. In this build there's no browser engine, so the patch makes it refuse the way URL scans do. `cert/cdp.mjs` against the published `@ai-ecoverse/wasi-impeccable@0.1.15-6` on slicc-kernel 1.134.3 (users enforce):

```text
browser-cert: FAIL packages/wasi-impeccable/cert/cdp.mjs
AssertionError [ERR_ASSERTION]: detect --cdp 9222 stderr="Warning: cannot access 9222\n"
  expected: /^Error: --cdp scans need a browser; not available in this build yet$/m
```

0.1.15-6 has no `--cdp`: it drops the flag and scans `9222` as a missing file. The 0.1.16-1 build passes it, with the other specs (checklist, deep, notices, telemetry, stress) and test/e2e on the same kernel. Without the patch's `detect_cdp_scan` it would print upstream's `Error: this build cannot attach to a running app (--cdp)`, which the spec also refuses.

Stress row, re-run for the moved HTTP core: 0.1.16-1 gives 0 traps in 6 rounds (13 s each), and the wasm memory never grows past the 64 MiB initial heap. Linked without `--initial-memory`, 0.1.16-1 peaks at 21 MiB under today's `stress.mjs` (polled once a second), and so does the published 0.1.15-4. recipe.yaml keeps its 64 MiB initial heap and the larger 49 MiB measurement.

## 0.1.17-1: `--version` comes from the recipe (cert/checklist.mjs, 2026-11-01)

`cert/checklist.mjs` hard-coded `0.1.16`, so every upstream bump failed it until someone edited the spec. It now reads the expected version from `recipe.yaml`. Against the published `@ai-ecoverse/wasi-impeccable@0.1.16-1` on slicc-kernel 1.134.3 (users enforce):

```text
browser-cert: FAIL packages/wasi-impeccable/cert/checklist.mjs
AssertionError [ERR_ASSERTION]: version="0.1.16\n"
'0.1.16' !== '0.1.17'
```

The local 0.1.17-1 build passes `checklist.mjs` and `cdp.mjs` on the same kernel.

## 0.1.18-2: the working directory, not a stale PWD (2026-11-09)

0001's `process_cwd()` returned `PWD` whenever it was absolute. A parent that sets a child's working directory without rewriting `PWD` (Node's `spawnSync` with `{ cwd }`, on real Node too) made impeccable resolve relative paths against the parent's directory, while std's own relative opens reached the real one. `process_cwd()` now takes `PWD` only when it is absolute, not `/`, has no `..` and is `.`'s device and inode, and otherwise the path found by walking `..` up to the root, as getcwd(3) does (wasi-libc's `current_dir()` is `/` in every case, measured with a Rust probe on slicc-kernel 1.134.3 and 1.176.2; see homescoop#2012).

The published 0.1.18-1 fails `cert/cwd.mjs` at `PWD=/tmp` (`Warning: cannot access dirty.html`, rc 1; `browser-cert --spec cwd.mjs`, slicc-kernel 1.134.3, users enforce). Run to the end, 10 of its 20 assertions fail: `PWD=/tmp` and `/nonexistent` don't find the file; `PWD=site` and `PWD=/` report it as `/dirty.html` (0.1.12-4's bug: a relative `PWD` fell back to `/`); and with the cwd `/` and `PWD` naming the site it reads the site's file. 0.1.18-2 passes all 20, the whole cert, and test/e2e (9 of 9).

## 0.1.21-1: the agents verb on real files (cert/agents.mjs, 2026-11-16)

engine-v0.1.21 adds `impeccable agents` (plan / apply / undo / status / list of a managed Claude Code or Codex instruction). Its atomic writes (`fs_writer.rs` `safe_write`, `lib.rs` `private_atomic_write`) name their temp files after `std::process::id()`, which panics on wasm32-wasip1. With 0001 rebased but those two calls left as upstream's, `cert/agents.mjs` fails at `apply` (rc 134, `panicked at …/sys/process/unsupported.rs: no pids on this platform`, `wasm trap: unreachable`; slicc-kernel 1.134.3, users enforce), and the lock it took (`~/.impeccable/agents/agents.lock`, the non-unix path) is left behind, so every later mutating `agents` call fails with `lock_timeout`. With `impeccable_common::process_id()` in both, the spec passes: plan, apply (CLAUDE.md carries the instruction), a second apply, status, list (one installation), no temp file or lock left, undo, list (none), and the whole cert.


## 0.1.22-1: the account verbs refuse on WASI (cert/account.mjs)

engine-v0.1.22 adds the account crate (`login`, `logout`, `whoami`, `health`, `pro-refresh`, design health uploads after `detect`, and Pro dispatch of scans) and the macOS-only `loop` verb. The account crate needs `ring`, a loopback OAuth listener and the OS keychain, so 0001 keeps it native and the verbs refuse. `cert/account.mjs` asserts `impeccable <verb>: needs Impeccable account sign-in; not available in this build yet` (rc 1) for each account verb and upstream's `Impeccable Loop is only available on macOS.` for `loop install`. The published 0.1.21-1 has neither verb and fails at its first step: `impeccable login` prints `Unknown command: "login"` (rc 1), which the spec's message check refuses.

## 0.1.23-1: setup reporting, critique sync and saved reports (cert/setup.mjs, cert/reports.mjs, 2026-11-19)

engine-v0.1.23 grows the account crate: setup reporting (`setup status|on|off|forget`, and a detached `setup-report` worker that `detect`, `context`, `doctor`, `whoami`, `agents`, `skills`, `install`, `update`, `check` and a successful `login` schedule once a day), critique sync (`critiques status|on|off|forget`, `critiques-refresh`, and `critique-storage write` uploading each saved critique) and `health-design-refresh`. 0001 keeps all of it native, as it does the rest of account: on WASI those verbs refuse with `impeccable <verb>: needs Impeccable account sign-in; not available in this build yet` (rc 1), nothing is scheduled, and `critique-storage` saves locally only. The context crate adds `audit-storage` (saved audit reports under `.impeccable/audit/`) and a `reports.enabled` project setting that turns saving off (`REPORTS OFF: …`); both work on WASI as upstream. `loop connect` / `loop disconnect` are new and refuse off macOS.

The published 0.1.22-1 fails both specs at their first step. Its `impeccable.wasm` holds none of the strings `setup-report`, `critiques-refresh`, `health-design-refresh`, `audit-storage`, `REPORTS OFF` or `loop connect` (`grep -c -a -F` gives 0 for each, against 1 for `needs Impeccable account sign-in` and for `Impeccable Loop is only available on macOS`): its router has no arm for these verbs, so `impeccable setup` (cert/setup.mjs) and `impeccable audit-storage write . report.md` (cert/reports.mjs) fall through to `Unknown command: "<verb>"` (rc 1), which the message and status checks refuse, and `loop connect` gets the loop usage instead of the macOS refusal. With 0001 rebased but upstream's `critique-storage` arm left in, the wasm build doesn't compile (`impeccable_account` is not a dependency there), and with `toml_edit` left where the 0.1.22 hunk moved `libc`, under the native-only dependencies, `loop_connect.rs` doesn't either; the 0.1.23-1 build checks clean for wasm32-wasip1-threads.

## 0.1.24-1: foundations, worlds, taste and walkthroughs (cert/foundations.mjs, cert/world.mjs, 2026-11-21)

engine-v0.1.24 adds `impeccable foundations` (an 18-item roadmap of what the project's own files show: secrets in the repository, giant files, CI that runs the tests, dependency scanning, icons, legal pages and more, plus the detector's contrast and generic-AI-pattern classes; a full `detect` computes the same states for design health's upload), the account verbs `world <id>` (seed DESIGN.md from the Impeccable catalog) and `taste-refresh` (the person's design preferences, cached in `~/.impeccable/taste.json`, which `context` then prints as a `YOUR_TASTE` block), `walkthrough <recording>` (an H.264 film and poster from a screen recording, made with the system's ffmpeg and ffprobe), and `loop status` / `loop connect --json`. 0001 keeps foundations on WASI: its walk and checks are file-local, its `git ls-files` goes through wasix-command (with no git in the kernel, a folder outside a git work tree is walked), and only the upload after it is left out with the account crate (router's `health_scan` and `foundations::from_scan`). `world` and `taste-refresh` refuse with `impeccable <verb>: needs Impeccable account sign-in; not available in this build yet` like the other account verbs, and `walkthrough` (base64 and the system's ffmpeg, native only) with `impeccable walkthrough: needs ffmpeg; not available in this build yet`. `context`'s taste block is file-local and works as upstream; the `loop` additions refuse off macOS as upstream.

The published 0.1.23-1 fails both specs at their first step. Its `impeccable.wasm` holds none of the strings `Usage: impeccable foundations`, `YOUR_TASTE`, `taste-refresh`, `impeccable world <id>`, `walkthrough` or `loop status` (`grep -c -a -F` gives 0 for each, against 1 for `needs Impeccable account sign-in` and for `Impeccable Loop is only available on macOS`): `impeccable foundations --json` (cert/foundations.mjs) and `impeccable world teletext-service` (cert/world.mjs) fall through to `Unknown command: "<verb>"` (rc 1), which the status and message checks refuse. With 0001 rebased but the new arms left as upstream has them, the wasm build doesn't compile (`impeccable_account` and `base64` are not dependencies there); cert/setup.mjs's loop usage check accepts 0.1.24's `loop connect [--agent claude|codex] [--json]` line as well as 0.1.23's.

## 0.1.25-1: the wiring check, detect --changed and loop connect --mcp-only (cert/wiring.mjs, cert/mcp.mjs, 2026-11-24)

engine-v0.1.25 adds `detect --before` / `--kept` (a page's wiring: links, forms, fields, buttons, handlers, ids, test hooks, scripts and label targets, saved under the project's `.impeccable/wiring/` and compared after a redesign), `detect --changed` (the UI files git reports as changed), `loop connect --mcp-only` (the Impeccable MCP server alone, on any OS and without the Loop app), the account verb `status`, the internal `motion-capture` verb (Chrome through the browser crate), and, after a sign-in, a repository scan for the account and a Loop offer. 0001 keeps `status` and the after-login work native with account, so `status` refuses like the other account verbs and `motion-capture` with `needs browser capture`. The wiring check is file-local and builds as is; `--changed`'s git goes through wasix-command, and with no git in the kernel it gives upstream's not-a-work-tree error.

The published 0.1.24-1 fails both specs at their first step. Its `impeccable.wasm` (`npm pack @ai-ecoverse/wasi-impeccable@0.1.24-1`) holds none of the strings `Saved the wiring`, `wiring kept`, `reads the changed files from git`, `--mcp-only` or `motion-capture` (`grep -c -a -F` gives 0 for each, against 1 for `No coding agent found to connect`, `needs browser capture` and the 0.1.24 `impeccable loop connect [--agent claude|codex] [--json]` usage line). Its detect drops flags it doesn't know, so `detect --before index.html` (cert/wiring.mjs) scans the page and saves nothing, which the `Saved the wiring of index.html …` check refuses; `loop connect --mcp-only` (cert/mcp.mjs) prints the loop usage (rc 1), which the spec's usage check refuses.

Upstream's code needed more than the rejected hunk on WASI. With 0001 rebased but the new code left as upstream has it, the wasm build would not compile (read from the source): `loop_connect.rs` names `impeccable_account::config` (the account services' origins and `IMPECCABLE_HOME`), `loop_install.rs`'s after-login offer names `impeccable_account::setup_status`, and `detect/src/changed.rs` hands a `std::process::Command` to `impeccable_common::proc::hide_window`, which takes wasix-command's on wasm. 0001 builds account's own `config.rs` into the cli as a module on wasm, keeps the after-login offer native, and gives the detect crate wasix-command. Once it compiles, `--mcp-only`'s agent lookup would still trap at its first step: it splits `PATH` with `std::env::split_paths`, which is `panic!("unsupported")` on WASI. A probe built with Rust 1.98.1 for wasm32-wasip1 and run under wasmtime with `PATH=/home/x/bin:/usr/bin:/bin` panics at `library/std/src/sys/paths/unsupported.rs:18:5` (rc 134, wasm `unreachable`), and the same probe's `std::process::Command::output()` returns `operation not supported on this platform`. 0001 splits `PATH` on `:` on wasm, and cert/mcp.mjs runs every `--mcp-only` case with `PATH` set. An agent with no Impeccable server yet is reported as `not connected`, since adding one runs the agent's CLI, which std can't start on WASI. The taste block's temp file is named after `impeccable_common::process_id()`, not `std::process::id()` (no pids on wasm32-wasip1); `loop connect` refuses off macOS before it gets there.

cert/world.mjs and cert/setup.mjs required the 0.1.24 `loop connect [--agent claude|codex] [--json]` usage line, which 0.1.25 spells `loop connect [--agent claude|codex] [--taste|--no-taste] [--json]`. Both now accept that spelling too and still require the line.

## 0.1.27-1: sampled contrast, SARIF, design maps, font-fetch and switches (cert/sampled.mjs, cert/design.mjs, cert/fonts.mjs, cert/switches.mjs, 2026-11-26)

engine-v0.1.26 and engine-v0.1.27 (this bump skips 0.1.26) add the static engine's sampled contrast (text over a local or data-URI `background-image` is measured against the image's pixels, decoded by pure-Rust decoders, and the samples are cached under `~/.impeccable/sample-cache/`), `detect --sarif` (a SARIF 2.1.0 log) and `detect --report-unused-ignores`, `design-compact` (a long DESIGN.md proposed as, and with `--write` turned into, the map `context` carries, the original moved to `.impeccable/design-full.md`), `design-lookup <term>`, `font-fetch "<Family>"` (a Google font's latin and latin-ext WOFF2 files downloaded into the project, with their `@font-face` rules), `switches [--catalog]` (which Impeccable lines each agent's user-level rule file holds), `first-viewport` and `shot` (Chrome over CDP), `mcp` (an MCP server proxying the account service's tools, in the new mcp crate, which depends on account), `switches-refresh` (the account's switch sync), `agents running` (the mcp crate's session records and a `ps` scan), the browser relay that `install` registers, install's sign-in offer and `context`'s `ACCOUNT:` line. 0.1.27 moves the Foundations file checks into the new foundations-scan crate, which builds for wasm as it is. 0001 keeps mcp, the switch sync and install's sign-in offer native with account: `mcp` and `switches-refresh` refuse with `needs Impeccable account sign-in`, `agents running` with `needs the Impeccable MCP server`, `first-viewport` and `shot` with `needs browser capture`, install registers no browser host and offers no sign-in, and `context` prints no `ACCOUNT:` line (init then asks `whoami`, which refuses, so the skill never offers a sign-in this build can't do).

The published 0.1.25-1 fails all four specs at their first step. Its `impeccable.wasm` (`npm pack @ai-ecoverse/wasi-impeccable@0.1.25-1`) holds none of the strings `sampled (coarse)`, `2.1.0`, `unused-ignore`, `Usage: impeccable design-compact`, `Usage: impeccable design-lookup`, `Usage: impeccable font-fetch` or `Usage: impeccable switches` (`grep -c -a -F` gives 0 for each, against 1 for `needs Impeccable account sign-in` and `Saved the wiring`; the 0.1.27-1 build has each). Its `detect --json light.html` (cert/sampled.mjs) answers `[]` with rc 0 for white text on a light image, which the `low-contrast` check refuses, and it drops `--sarif` (rc 0, empty stdout). `design-compact` (cert/design.mjs), `font-fetch Space Grotesk` (cert/fonts.mjs) and `switches` (cert/switches.mjs) answer `Unknown command: "<verb>"` (rc 1), which the status and message checks refuse. Checked on slicc-kernel 1.134.3's Node entry, the cert's kernel.

Upstream's code needed more than the rejected hunks on WASI. With 0001 rebased but the new code left as upstream has it, the wasm build does not compile: font_fetch.rs sets a browser User-Agent with `AgentBuilder::user_agent`, which wasix-ureq didn't have (`error[E0599]: no method named user_agent found for struct AgentBuilder`, crates/context/src/font_fetch.rs:92). Without it Google Fonts serves TrueType, so homescoop's wasix-ureq gains `AgentBuilder::user_agent` (crates/wasix-ureq/tests/ureq.rs checks the header), and cert/fonts.mjs's stand-in Google Fonts answers WOFF2 and serves the files only to a browser's User-Agent. Once it compiles, two new writes trap at their first step: the sample cache's temp file (html's `image_sampling.rs` `write_entry`) and design-compact's temp DESIGN.md are named after `std::process::id()`. A build of the rebased 0001 with those two calls left in, run on the same kernel, panics `no pids on this platform` at `library/std/src/sys/process/unsupported.rs:336:5` (rc 134, `wasm trap: unreachable`) in cert/sampled.mjs's first `detect --json light.html` and in cert/design.mjs's `design-compact --write`, which writes nothing. 0001 names both after `impeccable_common::process_id()`, as it does the others; agent_block.rs's rule-file writes (reached from `loop connect`, which refuses off macOS, and the native switch sync) get the same, and its `git` for Cursor's personal rule goes through wasix-command (with no git in the kernel, `switches` lists no Cursor line). cert/sampled.mjs reads the cache entry back (320 × 200, 36 samples of the image's colour). The new code has no `std::env::split_paths`; std's `fs::canonicalize` (font-fetch's inside-the-project check) works on wasm32-wasip1 with Rust 1.98.1.
