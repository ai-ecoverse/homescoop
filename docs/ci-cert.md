# CI certification specs

The cert specs here are how the certification bar is **encoded in CI**: the
`cert` job of every pull request's `ladder-build.yml` run runs them on the
tarball it built, and the pipeline's two reviewers read the results and try
the package themselves (*Review* below). [`scripts/ci-certified.json`](../scripts/ci-certified.json)
is the cert-covered set that Renovate may automerge; it is not a publish
gate. Every publish needs a green, reviewed pull request run whose artifact
is the published tarball (docs/ladder-builds.md, *Publish gate*).

## Layout

```text
packages/<name>/cert/
  meta.json          # optional: { "harness": "slicc-kernel" | "host-smoke" | "host-node" }
  *.mjs              # slicc-kernel CDP specs (default harness)
  NEGATIVE.md        # one recorded failure against a known-bad build
```

`scripts/browser-cert/run.mjs`:

1. If `cert/*.mjs` exists → boot slicc-kernel Chromium, install the PR tarball,
   run every `*.mjs` (default export `async (ctx) => …`).
2. Else if `browser-cert.json` or `slicc.commands` → legacy smoke (`--version` /
   JSON plan). **Not** enough for `ci-certified.json`.
3. Libs without commands → `host-smoke.sh` (`smoke.c`); mark CI-certified only
   when that smoke matches the checklist and `cert/NEGATIVE.md` exists.

## Harness choice

| Harness | Use for |
| --- | --- |
| **slicc-kernel CDP** (default) | Emscripten CLIs and WASI tools that run under `@ai-ecoverse/slicc-kernel` (jq, xz, git, coreutils, wasi-pnpm, wasix-python+numpy, …). |
| **host-smoke** | Static libs linked with `emcc` on the runner (`libpng`, `libtiff`, `lcms2`, `libxml2`, `libiconv`, `zlib`). |
| **host-node** | Special host scripts (`scripts/smoke-cmake.mjs`, `scripts/smoke-binaryen.mjs`, `packages/wasm-clang/test/run-cc.mjs`). `cert/meta.json` `"ci": ["<command>", …]` entries are run by the `cert` job after host-build, from the repo root (wasm-clang: compile wasix-sysroot's probes in the kernel, run them under users enforce, plus the 24.0.0-11 negative). |
| **Full SLICC realm** | Scoop/ipk/UI-coupled or cone-only behaviour. Rare for homescoop publishables; prefer slicc-kernel. If a checklist truly needs the cone, add a job that starts a SLICC leader and run `cert/*.mjs` there — call those out in `cert/meta.json` `"harness": "slicc-realm"`. |

The cert leg ([`scripts/browser-cert/cert-leg.mjs`](../scripts/browser-cert/cert-leg.mjs)) fails closed:

- A `host-node` or `host-smoke` harness must declare `ci:` commands. Without them, the leg fails with `<pkg>: cert harness <h> declares no ci commands; nothing was certified`. The job does not guess commands; the recipe declares them.
- A `cert/meta.json` that is there but is not readable JSON fails the leg, naming the file and the parse error. So does one that is JSON but not an object (`[]`, `"host-node"`, `42`, `true`, `null`): `<file> is not a JSON object (it is <kind>); nothing was certified`. So does a `ci` that is not a list, or a `ci` entry that is blank or not a string. `run.mjs` reads `meta.json` the same way (`scripts/browser-cert/cert-meta.mjs`) and fails before it boots anything.
- A leg that runs nothing (no `cert/*.mjs`, no Emscripten CLI to smoke, no `ci:`, or a `blocked` meta without `ci:`) passes, with a `::warning::` and a job-summary line, `<pkg>: no cert specs; this cert leg certifies nothing`. That green is a build, not evidence.

## Patch ↔ spec mapping

Every `packages/<name>/*.patch` must be named in `cert/meta.json` under
`patches`, with a cert case that exercises the patched code path. Specs that
only smoke `--version` are not enough for patched packages.

## Enabling automerge

1. Port the checklist into `cert/` (and map every patch in `meta.json`).
2. Negative proof in `cert/NEGATIVE.md`:
   - **With patches:** rebuild once with the SLICC patch removed; the cert
     case that maps to that patch (or the build) must fail. Record the log.
   - **Without patches:** `prove-negative.mjs` plus an in-spec
     wrong-output / non-zero-exit assert. It empties every WebAssembly
     module a command runs: each `slicc.commands` `wasm` (wasix-ruby's
     `bin/ruby` too), every `bin/*.wasm`, and any other `bin/` file that
     starts with `\0asm`. It passes other flags (`--kernel`, `--users`,
     `--cert`, peer `--tarball`s) to `run.mjs`, and it proves the negative
     only when a spec ran and failed: a cert that never got to a spec (no
     harness, no Chrome) proves nothing and exits 1.
3. Add the recipe dir name to `scripts/ci-certified.json` and run
   `node scripts/sync-ci-certified-renovate.mjs`.
4. Majors and brand-new packages stay `automerge: false` + label for human review.

Do **not** add `packages/<name>/cert/` stubs for blocked packages — any path under
`packages/<name>/` triggers the pull request's host-build for that recipe.

## Not CI-certified yet (blocked)

| Package | Blocker |
| --- | --- |
| cmake | host-build needs `slicc-emscripten` prebuilt `cmakemain.cxx.o`; use `scripts/smoke-cmake.mjs` (`harness: host-node`) once staged |
| findutils | 4.11.0 / gnulib getlocalename under emscripten; need `-exec`/`xargs -P` + wasm-coreutils |
| py-numpy / py-scipy / py-pandas | wasix stage/release 404 on Renovate bumps; import/numeric smoke under wasix-python once artifacts exist |

CI-certified set (automerge non-majors and kernel-compat's `ci-certified` set, not a publish gate): see `scripts/ci-certified.json`
(jq, xz, pkgconf, xxd, coreutils, gawk, sed, gzip, git, grep, procps, which).

## py-* python range

A py-\* takes wasix-python as a range ([versioning.md](versioning.md#exact-ai-ecoverse-pins),
#702). Its `cert/meta.json` installs the **newest** python in `needsInstall`
(`@ai-ecoverse/wasix-python@<newest>`), so the `cert` job's browser cert runs on
it, and declares one `ci` command:

```sh
node scripts/browser-cert/python-range.mjs <py-pkg> [--tarball .homescoop-out/package.tgz] [--lock-only] [--keep]
```

It takes the **floor** from the range in `packages/<py-pkg>/package/package.json`.
Both pythons must be in the range; it warns when npm has a newer one in the
range than `needsInstall`.

1. For the floor and the newest, `npm install --package-lock-only` of the
   tarball with that wasix-python must resolve exactly one python, at the
   top level, at that version. The exact-pinned release before it nests a
   second python under the newest, so this is its NEGATIVE.
2. Without `--lock-only` (every py-\* with C extensions),
   `scripts/cert-review/harness.sh` installs the cert's harness (kernel,
   `needs`, Chromium). The script then moves wasix-python to the floor and
   runs the package's specs again through `run.mjs`.

A py-\*'s import smoke is `pyImport(ctx, { pkg, module, version, minExt })` from
[`scripts/browser-cert/py-import.mjs`](../scripts/browser-cert/py-import.mjs).
It checks that the package brings no python of its own and that `module` imports
from `/node_modules/@ai-ecoverse/<pkg>` with no `PYTHONPATH` (discovery). It
imports every `*.cpython-314-wasm32-wasix.so` under the module, and there must
be at least `minExt` of them. A module named in `skip` is left out, and the spec's checklist says why (py-pillow's `PIL._imagingtk` traps on import, #588). It logs the wasix-python it ran on
(`pythonUnderTest(ctx)`).

## Context API (`cert/*.mjs`)

```js
export default async function (ctx) {
  const { run, write, read, assert } = ctx;
  const r = await run(['jq', '-n', '1+1']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '2\n');
}
```

`run` accepts `{ cwd, env, stdin }`.

### Files: `ctx.write(path, data)`, `ctx.read(path)`, `ctx.readBytes(path)`

`write` takes a string (written as UTF-8) or bytes (a `Uint8Array`, `Buffer`,
any typed-array view or an `ArrayBuffer`), which are written exactly. `read`
returns the file decoded as UTF-8 text, so use it for text only: a binary
file comes back damaged (#738). `readBytes` returns the file's exact bytes
as a `Buffer`. Both return `null` for a missing file. Bytes cross to the
page as base64; `scripts/browser-cert/selftest/binary.mjs` round-trips all
256 byte values both ways (#591, #738).

### Terminal: `ctx.pty(argv, { cols, rows, env, cwd, steps, timeoutMs })`

This runs `argv` as the session leader of a real pty (`kernel.openTerminal`; the kernel adds
`TERM=xterm-256color`). Each step waits for its `expect` regex in the output
since the previous match, then types `write` (`sleepMs` pauses first). It
resolves `{ status, out }`, where `out` is the raw terminal output. If an
`expect` never appears, it hangs up and returns `status: null` with
`failedStep`. If the program does not exit within `timeoutMs` after the last
step, it also hangs up and returns `status: null`. See
`packages/less/cert/checklist.mjs`.

### Network: `ctx.serve(responder)`

The cert page gives the kernel a network transport whose far end is
`responder`. That's a self-contained function, which runs in the page:
`({ url, method, headers, body }) => ({ status, statusText, headers, body })`,
where `headers` is a list of `[name, value]` pairs and `body` is a string or a
`Uint8Array`. Programs reach it through the kernel's realm proxy as usual, so
http, https (CONNECT, terminated with the kernel CA), redirects (not followed
by the transport) and encoded bodies all behave as they would against a real
server. https also needs `@ai-ecoverse/wasm-tls-engine` in `needs`; without it
the kernel answers CONNECT with 501. Before `serve`, every request gets a 502.
See `packages/curl/cert/checklist.mjs`.

### Users: `"users"` in `cert/meta.json`

`"users": "enforce"` (or `"report"`) boots the kernel with `createKernel({ users })` (slicc-kernel ≥ 1.57.0 for file owners, ≥ 1.59.0 for the WASI owner imports, the permission checks of K3(b) later): files have owners and modes are checked. A spec adds users with `ctx.addUser({ name })` and runs as them with `ctx.run(argv, { user })`. Without the field the kernel boots with users `'off'`, as before.

### Command file modes

`scripts/host-run.sh` sets every file a package's `slicc.commands` names (`glue`, `wasm`, `script`) to 0755 before `npm pack` (`scripts/command-modes.mjs --fix`), and fails if one of them is not 0755 in `package.tgz` (`--check`). Under slicc-kernel's users enforce a 0644 glue run by path is `Permission denied` (126). Packaging-only repacks keep the published tarball's modes.

### Glue by path (#360)

After the specs, `run.mjs` runs every distinct `glue` file of the package's
`slicc.commands` **by path**, as a non-root user (`certglue`, added with
`kernel.users.add`): `/node_modules/<package>/bin/<glue> --version`, from
`/tmp`, with an empty stdin. A glue the kernel won't execute (rc 126, or
`EACCES`/`EPERM` from `kernel.run`) fails the cert as the `glue-by-path`
spec; any other outcome passes, since only the mode is in question. So every
package is checked the way coreutils' and tar's `glue-mode.mjs` check theirs,
without a spec of its own. It runs only where the answer means something:
users `enforce` (the `meta.json` value, `--users`, or the kernel default from
1.74), a kernel that stamps tarball modes (`modes: tarball`, slicc-kernel ≥
1.86.0), and not under `--soft` (kernel-compat runs published packages, some
of which still ship 0644 glue) or `--live`. `"glueByPath": false` in
`cert/meta.json` turns it off for one package. `@ai-ecoverse/wasm-tar@1.35.0-5`
(0644 `bin/tar`) fails it on slicc-kernel 1.88.0 with
`EACCES: /node_modules/@ai-ecoverse/wasm-tar/bin/tar`; 1.35.0-6 passes.

A package whose cert kernel can't run it (before 1.86.0, or users not
`enforce`) used to skip it in the PR cert job for good (#628). Now
`cert-leg.mjs browser-extra`, run after the specs, runs
`run.mjs --glue-only --users enforce` once more on the root `package.json`'s
certified dev-pin kernel for such packages: only glue by path, no specs.

### Extra kernels: `"extra_kernels"` in `cert/meta.json`

A string entry is a note: a kernel the specs were checked on by hand.
The PR cert job doesn't run it. An object entry is run by the cert leg (#663):

```json
{ "kernel": "@ai-ecoverse/slicc-kernel@1.90.0", "why": "slicc-kernel#568's linkat",
  "specs": true, "env": { "TAR_LINKAT": "1" } }
```

- `specs`: `true` (every spec) or a list of spec file names, run in the
  browser on `kernel` (`cert-leg.mjs browser-extra`, after the cert kernel's
  run). `cert` names a subdirectory of `cert/` to take them from instead
  (`"cert": "k108"`), and `users` overrides `meta.json`'s users.
- `ci`: host commands, run after the top-level `ci` ones with
  `HOMESCOOP_CERT_KERNEL=<kernel>` and `env` in their environment, so a
  command passes it on itself (`--kernel "$HOMESCOOP_CERT_KERNEL"`).
- `kernel` is an exact version and `why` is required; an entry that runs
  nothing, an unknown key, or `specs` on a host harness fails the leg.

### Peers: `"peers"` in `cert/meta.json`

`"peers": ["imagemagick", "imagemagick-heif"]` names other recipes whose
artifacts from the same pull request run the cert job downloads, when they
were built in it, into `.homescoop-out/peers/host-<peer>-pr<N>/`
(`package.tgz`, `package.tgz.sha256`). This is for `ci:` commands that check
the package against what its peers will publish:
`packages/imagemagick-relink/cert/relink-check.mjs` compares each kit's
`kit.json` with the runtime `bin/magick.wasm` (homescoop#678). A peer that
the PR doesn't build has no artifact, so the command has to look on the
registry instead. `peers` must be a non-empty list of other recipe names;
anything else fails the leg.

### Time per call: `"runTimeoutMs"` in `cert/meta.json`

Each page call (`ctx.run`, `ctx.write`, …) has to answer within 120 s, or the spec fails with `Runtime.evaluate: no answer in … ms`. `"runTimeoutMs"` changes that for one package. The harness's own default was 30 s, which wasix-python's venv and pnpm-layout steps outgrew on slower CI runners.

### Third-party notices: `"notices"` in `cert/meta.json`

A package that bundles or statically links third-party code (OpenBLAS,
FreeType, Qhull, pybind11, fonts, ...) lists each component with its SPDX
license expression, and its cert gets a one-line spec
([`notices.mjs`](../scripts/browser-cert/notices.mjs); homescoop#726):

```json
"notices": [
  { "name": "OpenBLAS", "license": "BSD-3-Clause" },
  { "name": "FreeType", "license": "FTL OR GPL-2.0-only" },
  { "name": "BaKoMa fonts", "license": "LicenseRef-BaKoMa", "text": "BaKoMa Fonts Licence" }
]
```

```js
// packages/<name>/cert/notices.mjs
import { noticesSpec } from '../../../scripts/browser-cert/notices.mjs';
export default noticesSpec(import.meta.url);
```

The spec fails unless the installed package's `THIRD-PARTY-NOTICES.md` has,
for each component, a `## ` heading naming it, the license named in that
heading or on a `License: ...` line of the section (an SPDX id of the declared
expression: one alternative of an `OR`, every part of an `AND`), and the
license text itself (a phrase of it: `"text"`, or the built-in phrase for each
SPDX id in `LICENSE_PHRASES`, taken from the license body so a one-line
"Licensed under ..." reference does not pass; same `OR`/`AND` rule, `AND`
binding tighter, parentheses grouping). An id with no
built-in phrase (a `LicenseRef-*`) needs `"text"`. `homescoop_notice`
([`build-common.sh`](../scripts/build-common.sh)) writes that shape:
`homescoop_notice "FreeType 2.13.3 (FreeType License, FTL)" <LICENSE.TXT> - <FTL.TXT> -`.
`scripts/test/notices.test.mjs` checks every `"notices"` list and that it has
its spec. Add a checklist line for `cert/notices.mjs`.

### WebSockets: `ctx.serveWs(responder)`

The cert page's transport also has the kernel's optional `websocket`
(`traits.websocket`), so a program's WebSocket through the kernel's proxy
(absolute-form `ws:`, or `wss:` inside a `CONNECT` tunnel the kernel
terminates) gets a far end too: `responder`, a self-contained function that
runs in the page. It gets `{ url, protocols, headers, send(data), close(code,
reason) }` for one socket, where `send` delivers a text (`string`) or binary
(`Uint8Array`) message to the program and `close` ends the socket with that
code. It answers `null`, which refuses the open (the program sees `502`), or
`{ protocol, message(data), close(code, reason) }`, its callbacks for what
the program sends. Before `serveWs` every open is refused. `ctx.wsLog()`
returns one record per socket: `{ url, protocols, headers, sent, received,
closed }`, where `sent` is what the far end sent and `received` is what the
program sent (binary messages as `{ binary: <bytes> }`).

```js
await ctx.serveWs(({ protocols, send }) => ({
  protocol: protocols[0] || '',
  message(data) { send(typeof data === 'string' ? `echo:${data}` : data); },
}));
const r = await ctx.run(['curl', '-sS', 'wss://echo.test/']);
```

`wss:` also needs `@ai-ecoverse/wasm-tls-engine` in `needs`, as for https.
Programs that skip the proxy and dial TCP themselves (websocat) reach the
outer world only through an uplink (`ctx.uplink`), whose scripted peers
answer once and close. websocat's outer `ws:`/`wss:` cert runs on the Node
entry with host-side echo servers (`packages/wasix-websocat/test/uplink.mjs`).
[`scripts/browser-cert/selftest/websocket.mjs`](../scripts/browser-cert/selftest/websocket.mjs)
is the harness's own spec. `compat.mjs` runs it on npm `latest` of
wasm-curl: curl's `ws:`/`wss:` receive side, plus bash speaking the frames
by hand on `127.0.0.1:3128` for the send side.

### Tailnet: `ctx.uplink(config)`

With `"uplink": true` in `cert/meta.json` (slicc-kernel ≥ 1.28.0)
the kernel boots with an uplink that routes `100.64.0.0/10`, built on the
kernel's `@ai-ecoverse/slicc-kernel/testing` `fakeUplink`. Until a spec sets
it up, every name is unknown and every dial refused. Packages without the
flag boot as before.

```js
await ctx.uplink({
  names: { 'peer.tail1234.ts.net': ['100.64.1.2'] },
  peers: {
    '100.64.1.2:8080': { http: { status: 200, headers: [['Content-Type', 'text/plain']], body: 'hi\n' } }, // one response, then close
    '100.64.1.2:9090': { error: 'ECONNREFUSED' },
  },
});
const r = await ctx.run(['curl', '-sS', '--noproxy', '*', 'http://peer.tail1234.ts.net:8080/']);
const { asked, dialled, requests } = await ctx.uplinkLog(); // requests[i].head: the HTTP request head
```

## Kernel compatibility: `scripts/browser-cert/compat.mjs`

The `kernel-compat.yml` workflow (and its merge-queue proof) is retired with
the move to one workflow. The question it asked, whether the **published**
packages still pass their cert specs on kernel X, is still answered by
`scripts/browser-cert/compat.mjs` (`plan`, `shard`, `report`), run by hand
with the cert harness installed (`scripts/cert-review/harness.sh`); its
`known-limits.json`, base sweep and self-test stay in `scripts/browser-cert/`.
A PR's own packages are checked on the cert kernel by the `cert` job, and on
slicc-kernel `latest` by the reviewers' cli browsers.

## Gate verdict lines

A gate's silence must never read as a pass (#968). Every script that gates a merge, a release or a cert prints `<gate>: PASS <detail>` when it passes (and `<gate>: FAIL <detail>` where it can), and every caller runs it through `node scripts/gate.mjs <gate> -- <command> …`. The wrapper streams the child's stdout and stderr unchanged, so `x=$(node scripts/gate.mjs dev-pin -- node scripts/dev-pin.mjs …)` still captures the value. It exits with the child's code. When the child exits 0 without a `<gate>: PASS` line it exits 3, so an early exit 0, a CLI guard that didn't fire, or empty output fails the job. The gates are check-exact-pins, check-cert-kernel, browser-cert/cert-kernel (`cert-kernel`), dev-pin, browser-cert/compat (`compat plan|shard|report`; a report with 0 rows that ran is a FAIL), cert-review/repack-input, ladder-merge-resolve and npm-publish (`publish`), and (#981's second half) npm-parity, check-package-meta (`package-meta`), refresh-recipe-sha `--verify-repack` (`recipe-sha`), host-smoke.sh (`host-smoke`; PASS with no `smoke.c`), browser-cert/run.mjs (`cert-run`, also glue by path and cert-leg's extra-kernel runs), browser-cert/cert-leg (`cert-leg` plan, browser-extra and ci; plan prints its verdict on stderr, since its stdout is `GITHUB_OUTPUT`), assert-certified-publish (`certified-publish`; exit 10, already on npm, prints FAIL and is passed through as the skip; npm-publish runs it directly and treats an exit 0 without its PASS line as a FAIL). `scripts/test/gate-verdict.test.mjs` checks that each prints its line and that every call in ladder-build.yml, host-run.sh and cert-review/harness.sh goes through gate.mjs. harness.sh may run at a ref that predates gate.mjs, so it uses it only when `scripts/gate.mjs` exists.

## Artifacts: the publish takes the reviewed one by id and digest

Jobs that run a PR's code can reach the run's artifact token and upload into
the run's artifact namespace (cert lane, from slicc-cdp#273). Within a pull
request's run, the build jobs and the reviewers download `host-<pkg>-prN` by
name: it is that run's own build, and the reviewers judge exactly those
bytes. The publish never trusts a name: `scripts/ladder-merge-resolve.mjs`
takes the PR's `host-<pkg>-prN` artifacts, keeps only those from a
`ladder-build.yml` `pull_request` run at the merged head that concluded
`success`, downloads the zip by artifact id, checks it against the
artifact's digest, and checks `package.tgz` against its `package.tgz.sha256`
and the merged package.json's name and version. `scripts/cert-review/artifacts.mjs`
(gate `artifact-pick`) keeps the by-id-and-digest check for any future
consumer. `scripts/test/artifact-consumers.test.mjs` fails on a `gh run download`
and on `merge-multiple: true` in the workflow.

## Review: slicc-shared-web's pipeline

There is no separate certification workflow. Every pull request's
`ladder-build.yml` run ends in slicc-shared-web's
[pipeline](https://github.com/ai-ecoverse/slicc-shared-web#pipeline), whose
two reviewers (Claude with claude-code-action, Codex with codex-action, both
on Bedrock) review the change, the packages it built and its cert results, and
must both approve. `ci` needs the pipeline, so that approval is part of the
one required check, and the push to `main` publishes only a PR artifact from a
green run (docs/ladder-builds.md, *Publish gate*).

- **What the reviewers get:** the pipeline's context (diff, comments, issues),
  `$RUNNER_TEMP/review/artifacts/host-<recipe>-prN/` (the tarballs that get
  published) and `cert-<recipe>-prN/browser-cert.json` (this run's cert
  reports), the results of every build job in the prompt, and four browsers
  with the packages loaded by `scripts/review-browser.mjs`: head (the PR's
  tarballs) and base (npm's) × the cert kernel and slicc-kernel `latest`,
  each with the cert spec context over HTTP. The homescoop part of the
  prompt is `review-prompt` in `ladder-build.yml`: the checklist the cert
  review had (what changed, specs, checklist and patches, upstream sha256,
  licences, security surface, trying the package as seven would), and its
  severity policy (roll forward; deny only for security, data loss,
  supply-chain, licence, a crash, or a regression without a workaround).
- **Known issues** go in each reviewer's `issues` list, titled
  `[cert] <recipe>: …`; the pipeline's `post` job opens each unless one with
  the same title is open, and `issue-labels` labels them within the hour. A
  package's missing specs collect on one `[cert] <recipe>: cert coverage gaps` issue.
- **Every PR is reviewed,** Renovate's too (`review-renovate: '*'`), and a fork's
  PR can't be (it gets no secrets), so its `ci` stays red: open it again from
  a branch here.
- **The deterministic gates stay in the build jobs:** `npm-parity` (behind,
  drift, no-latest), the build-input root rule below, `reproducible`, and
  the cert specs. At publish, `assert-certified-publish.mjs` refuses a
  version that sorts below its tag by then, and a version npm already has with
  other contents (#971).

### Build inputs: the root rule (`scripts/cert-review/repack-input.mjs`)

- **A repack's input must be attested** (cert lane rule, 2026-10-16, from #730). The `npm-parity (<recipe>)` job runs `scripts/cert-review/repack-input.mjs` on each built package (gate `repack-input`). For a recipe with `repack: from:` it follows the chain back through the published versions (a version is a repack if the `recipe.yaml` in its tree has `repack:`) to the first version that was actually built, the root. Every version in the chain needs an npm provenance attestation for its own sha512 from `ai-ecoverse/homescoop`'s `ladder-build.yml` on `refs/heads/main`; the root also needs, in the tree at its attested commit, a `source.sha256` pin, a build that `homescoop_fetch`es that source (its sha argument is `$SRC_SHA`/`$SHA`, which `homescoop_load_recipe` exports from `source.sha256`, or the same literal; a fetch of something else doesn't count), and no way to stage a prebuilt artifact instead of compiling: no env-overridable `*_STAGE`, `*_WHEEL`, `*_PREBUILT`, `*_RELEASE_URL` or `*_ARTIFACT` input, no tree outside the repo (`$ROOT/..`), no download of homescoop's own releases. These rules read build.sh and every repo script it runs or sources, recursively (depth cap 8): `scripts/*.sh`, package-local helpers (`$HOMESCOOP_PKG/<x>.sh`, `$(dirname "$0")/<x>.sh`, `./<x>.sh`, `bash <x>.sh`); an explicit reference that isn't in the tree fails closed. That last rule is static because no run records which path it took. A root without provenance can still count through `--reproduced` (a matching `dist.integrity` from an independent rebuild). Otherwise it prints `repack-input: FAIL <recipe>: unverifiable: <reason>` and fails the job, so `ci` fails and nothing publishes; a trace that couldn't run fails too. Run it locally with `node scripts/cert-review/repack-input.mjs --package <recipe> [--ref <commit>]`.
- **The root rule for every build, not just repacks** (cert lane ruling on #858/#859, audit #864). For a recipe with no `repack:`, the same `repack-input.mjs` run applies the root's static rule to the recipe and build scripts at the reviewed head: a `source.sha256` pin that a `homescoop_fetch` of `$SRC_SHA`/`$SHA` (or the literal) fetches, and no stage or prebuilt path. Its JSON is `{ "repack": false, "built": true, "attested": true|false, "reason": … }`, and the job passes only with `attested: true`. A recipe whose source is committed here declares `source:` / `in-tree: "<paths under packages/<pkg>/>"` instead of `url`/`sha256`. That declaration is verified, never trusted: each path must be in the judged tree; the package's own build files (`packages/**/*.sh`; the shared `scripts/*.sh` installers check their own pinned sha256) must download nothing a pinned sha256 or lockfile doesn't cover. That rules out `curl`, `wget`, `git clone`/`fetch`, `homescoop_fetch` without a literal sha256, `pip install` without `--require-hashes`, `npm install`/`npx`/`pnpm add`/`yarn add` (allowed: `npm ci`, `--frozen-lockfile`), `cargo install`/`build`/`fetch` without `--locked`/`--frozen`/`--offline`, `go install`/`go get`, `rustup` installs, and system package managers. The prebuilt rule also applies. A declaration that fails fails the job. Script references are followed per package: a loop variable naming the package (`for r in a b; do bash "$HOMESCOOP_ROOT/packages/$r/build.sh"`) is expanded for each word, and once-assigned path variables in a package's own files are substituted. A loop variable that's also assigned elsewhere, a package name held in any other variable, or a variable reference that would resolve to the referencing file itself, all fail closed. A `$SRC_SHA`/`$SHA` fetch counts for the recipe only in its own `packages/<pkg>/` files and the shared `scripts/`, or in a followed `packages/<other>/` whose recipe pins the same sha256. Every followed `packages/<other>/` must pin and fetch its own source.
- **Build inputs must trace to attested roots** (cert lane ruling, 2026-10-17, on #864). Once the package's own rule passes, `repack-input.mjs` collects the homescoop build inputs of the build it judged: the recipe at the reviewed head for a built recipe, or at the root's commit for a repack. Then it traces each input. Tool-only inputs and shipped ones get the same check. There are three kinds of input:
  - every `@ai-ecoverse/<name>@<version>` in the dependency lists `host-run.sh` installs into the prefix (`build`, `host`, `run`, `mamba` and `npm`, as `read-recipe.mjs --deps` prints them). Only an exact version counts; a range or a bare name under the scope fails closed. Bare forge/mamba names are skipped, as `host-run.sh` skips them;
  - every `source.url` or `sources.*.url` on `registry.npmjs.org/@ai-ecoverse/`. That's an input, not a pinned upstream source (the wasix-sysroot -29…-32 case, whose `source.url` is the unattested -14 tarball);
  - every `registry.npmjs.org/@ai-ecoverse/<name>/-/<name>-<version>.tgz` in the build files, and every `npm pack|install|add`, `pnpm add|dlx`, `yarn add` or `npx` of an `@ai-ecoverse/` spec. That covers install-* helpers such as `scripts/install-wasixcc.sh` and its pinned sysroot. A version held in a variable resolves through that file's own assignments, including the default of a `${OVERRIDE:-<version>}`. An override that any build file assigns adds its value as an input too. A version that can't be resolved fails closed. A command counts when it's indented or prefixed (`env A=1 npx …`, `command`, `sudo`, `exec`). The only heredoc bodies this skips are a `cat`/`tee` into a documentation or data file (`.md`, `.txt`, `.json`, `.xml`, `.html`, `.pc`, `.yaml`, `.toml`, `.cfg`, `.conf`, `.ini`) with no pipe; it scans any other heredoc, including one piped to a shell or written to a script.

  To trace an input, `repack-input.mjs` finds its recipe dir: the published `repository.directory` first, then the npm name with or without `wasm-`. The recipe at that commit must build that npm name. The input must meet the repack rule above at its pinned version: provenance from ladder-build on main through the whole chain, then the root's static rule. Its own build inputs are then traced recursively, up to 8 deep. A cycle fails closed. The JSON gains `inputs` (`[{ input, via, ok, known? }]`) and `known`.
- **The known list** is `scripts/cert-review/known-inputs.txt`, read from the pull request's tree, so a PR that adds itself to it shows that in its diff, for the reviewers. It has one `<@scope/name>@<version> #<issue> <reason>` per line and no comment lines; a malformed or repeated line is an error, and the job fails. These are the cases:
  - an unattested input that isn't on the list: unverifiable (`build input <name>@<version>: <why>`), and the job fails;
  - an input that is on the list: it passes, and the JSON's `known` names it (`links unattested <name>@<version> (homescoop#<issue>)`);
  - an attested input whose own inputs include a listed one: it carries that entry up to the dependent;
  - an entry **expires** once its package has an attested successor: a version published later (by the packument's `time`; with no times, any other version), with provenance, whose trace passes without that entry. A successor that only passes through other unexpired entries still counts. From then on, a dependent that pins the old version fails (`… the entry has expired: bump to it`) until it bumps.
- **Not checked:** the sigstore signature on an attestation bundle. npm verifies it at publish and serves it over HTTPS, and `npm audit signatures` checks it again offline.
- **CLI:** `node scripts/cert-review/repack-input.mjs --package <recipe dir> [--ref <commit>] [--repo owner/repo] [--npm <name>] [--reproduced <file.json>] [--known <file>] [--fixtures <dir>]` prints `{ package, npm, repack, built?, chain, root, attested, reason, inputs, known }`. It exits 0 when attested, 1 when unverifiable, and 2 when the trace couldn't run. It reads trees with `git show` in the current clone, or through the GitHub contents API with `--repo` (the npm-parity job does that). It reads packuments and attestations from registry.npmjs.org, or from recorded fixtures: `<dir>/packument/<npm, / as %2f>.json`, `<dir>/attestations/<npm, / as %2f>@<version>.json`, `<dir>/tree/<commit>/<path>`. `--reproduced` is a JSON object `{ "<npm>@<version>": "<dist.integrity of an independent rebuild>" }`. The provenance must be for the tarball's own sha512, because a CI repack is a pure function of its input and the repo's files, and a laptop publish isn't. The tree it judges is the attested commit, or the gitHead when there's no attestation.

## Certification exceptions: `certification-exceptions.json`

bios's v2 gate (PM, 2026-10-20) accepts a changed homescoop pin only when its npm SLSA provenance is `ai-ecoverse/homescoop`'s `.github/workflows/ladder-build.yml` at `refs/heads/main`, on a hosted or a pool runner, and its `dist.integrity` equals bios's lockfile. It doesn't read dist-tags, and npm-deprecated versions fail. There's no accept list: a version without that provenance fails, with no way around it. Provenance alone isn't enough, though. Some versions with main provenance were ruled uncertified (py-pandas 2.3.2-11, a repack of an unverifiable build). And some are certified only under a condition (wasm-bash 5.3.0-20 needs slicc-kernel ≥ 1.130.2). Those go in `certification-exceptions.json` at the repo root.

bios reads the file at a homescoop commit pinned in its own config, and a bios PR bumps that pin. So a change here reaches bios only through a reviewed bios PR, and every read is reproducible. A missing or unparseable file fails the gate closed.

```json
{
  "schema": 1,
  "entries": [
    { "package": "@ai-ecoverse/py-pandas", "range": ">=2.3.2-5 <=2.3.2-11", "verdict": "fail",
      "issue": "https://github.com/ai-ecoverse/homescoop/issues/730", "ruling": "cert lane 2026-10-17 03:45: …" },
    { "package": "@ai-ecoverse/wasm-bash", "versions": ["5.3.0-20"], "verdict": "requires",
      "requires": { "@ai-ecoverse/slicc-kernel": ">=1.130.2" },
      "issue": "https://github.com/ai-ecoverse/homescoop/issues/1230", "ruling": "cert lane 2026-10-19 12:40 and 16:45: …" }
  ]
}
```

- **Top level:** exactly `schema` (1) and `entries`. Any other key fails closed.
- **An entry:** `package` (`@ai-ecoverse/<name>`), exactly one of `versions` (a non-empty list of exact versions) or `range`, a `verdict`, an `issue` (`https://github.com/ai-ecoverse/<repo>/issues/<n>`, open or closed: the issue is the record), and a `ruling` (one line: who ruled, when, and why). Any other key, or any other verdict, fails closed.
- **`range`** is read by node-semver with `includePrerelease: true`. This file uses only exact comparators (`=`, `<`, `<=`, `>`, `>=`, space-separated, `||` between alternatives), and the audit refuses anything else (`^`, `~`, x-ranges, hyphen ranges, a space after the operator). Version order on that subset is plain semver order, so the audit and node-semver agree. A version that one entry lists exactly and another entry's range also covers is an error.
- **`verdict: "fail"`** rejects the pin.
- **`verdict: "requires"`** rejects it unless every bios pin of each package named in `requires` satisfies that range. `requires` is allowed only with this verdict.
- **What goes in:** every version that a ruling found uncertified or conditional, with or without main provenance. Versions without provenance fail at the gate anyway; their entries keep the record. The seed (cert lane, checked against its ledger) is: the #864 FAIL set in `scripts/cert-review/known-inputs.txt` (every line there must have a fail entry, and the test checks it); the 2026-10-17 rulings at 03:45 (#730), 04:10 (#826), 04:40 (#858/#859: each chain's root plus every version that repacks down to it, from git history; pkgconf, py-kiwisolver, wasix-autoconf and wasix-ruby stay certified), 05:05 (#864 group 1: the latests it ruled on, plus #864's rows for packages with no recipe), 05:55 (the #864 transitive FAIL list, plus wasix-sysroot 2025.9.30-28, whose lane line it withdrew) and 06:10 (wasix-python 3.14.2-16); and wasm-bash 5.3.0-20's `requires`. Deprecated versions stay out, because the gate rejects them on its own. Later CI builds that fix a ruling (py-cycler 0.12.1-8, wasm-git 2.55.0-16 and so on) stay out as well.
- **Entries don't expire.** A published version never changes, so a fail or requires entry is permanent.

`scripts/certification-exceptions.mjs` checks the file, and `scripts/test/certification-exceptions.test.mjs` tests it offline on fixtures:
- `node scripts/certification-exceptions.mjs` checks the schema and that known-inputs.txt is covered.
- `--check` also checks npm and GitHub: every package and listed version is published, a range matches at least one published version, the packages named in `requires` exist, and every issue exists. An unknown name is a typo.
- `--audit <lockfile>…` (package-lock.json v2/v3 or pnpm-lock.yaml v9) does all of that, then prints one line per distinct homescoop pin. A pin counts as homescoop's when some `packages/*/package/package.json` here publishes its name, when an entry names it (entries outlive the tree), or when its provenance names homescoop's repository. The line reads `pin: PASS|DENY|FAIL <name>@<v> (<why>)`. The checks run in order:
  1. FAIL when the version isn't on npm, the lockfile integrity is missing or differs from npm's `dist.integrity`, or npm has deprecated the version.
  2. DENY when a fail entry covers the version, or a requires entry isn't met by bios's pins.
  3. FAIL when the version has no ladder-build@main provenance for those bytes (`checkProvenance` in `scripts/cert-review/repack-input.mjs`), or when that provenance's builder is neither `…/actions/runner/github-hosted` (hosted) nor `…/actions/runner/self-hosted` (pool).
  4. PASS otherwise. The line names the attested commit and the runner (`hosted` or `pool`), and any requires entry it met.

  This audit never prints ACCEPT, because there's no accept list.
- Every run ends with `certification-exceptions: PASS …` or `certification-exceptions: FAIL …` and exits 1 on any problem, or on any pin that isn't PASS. `--file` reads another exceptions file, `--known` reads another known list, and `--fixtures <dir>` replaces npm with repack-input.mjs's fixture layout (`packument/`, `attestations/`) and GitHub with `<dir>/issues.json`, a list of URLs.
- The audit doesn't check the sigstore signature on the attestation bundle (see the cert review's "Not checked" above).

## Issue labels: `scripts/issue-labels.mjs`

Every issue gets labels when it is filed, because `next-build` drives the pull request's known-issues comment: an unlabelled known issue never shows up on its package's next pull request. One script holds the mapping, and every filer uses it.

- **From the title.** Leading `[tags]` first: `[cert]` → `next-build`, `[repro]` → `repro`, `[plan]` → no `next-build`, and a tag that names a recipe counts as that recipe. Then `slicc-kernel: …` → `area:kernel` (and no `next-build`). The packages are the leading list before the first `:` (`[cert] which, tree, util-linux: …`, `wasix-gnupg 2.4.9-9: …`), by recipe dir or npm name, with `*` globs; a package there adds `next-build` and its area: `py-*` and `wasix-python` → `area:python`, `wasix-sysroot` → `area:sysroot`, `wasm-clang`, `wasm-emscripten`, `wasm-binaryen`, `wasi-llvm` and `wasm-go*` → `area:toolchain`. Keywords in the rest add the class: `repro`, `license`, `supply-chain`, `data-integrity`, `cert-coverage`, `harness`, `docs` and `ci`. A title that matches nothing gets `triage`, so someone labels it by hand.
- **The filers:** the pipeline's reviewers file known issues as `[cert] <package>: …` (see *Review* above); `node scripts/issue-labels.mjs --title '<title>'` prints the labels such a title gets.
- **The labeller:** `ladder-build.yml`'s `issue-labels` job, with `issues: write` only. On `issues: opened`, an issue that arrives with no labels gets `labelsFor(title)`, and one that already has labels is left alone. Issues filed with a workflow's `GITHUB_TOKEN` (the reviewers') start no workflow, so the same job also runs hourly and labels every open unlabelled issue.
- **The backlog:** `GH_TOKEN=… node scripts/issue-labels.mjs --backlog` lists what it would add to every open unlabelled issue, skipping #7 and #390. `--apply` adds the labels, creating any that are missing.
- The table of real titles is `scripts/test/issue-labels.test.mjs`. Add a row when a title is labelled wrong.
