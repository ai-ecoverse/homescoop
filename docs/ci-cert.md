# CI certification specs

Human certification remains the bar. `ladder-pr` browser-cert / host-smoke are
how that bar is **encoded in CI** so recipe bumps can automerge once a package
is listed in [`scripts/ci-certified.json`](../scripts/ci-certified.json).

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
| **host-node** | Special host scripts (`scripts/smoke-cmake.mjs`, `scripts/smoke-binaryen.mjs`, `packages/wasm-clang/test/run-cc.mjs`). `cert/meta.json` `"ci": ["<command>", …]` entries are run by `ladder-pr` after host-build, from the repo root (wasm-clang: compile wasix-sysroot's probes in the kernel, run them under users enforce, plus the 24.0.0-11 negative). |
| **Full SLICC realm** | Scoop/ipk/UI-coupled or cone-only behaviour. Rare for homescoop publishables; prefer slicc-kernel. If a checklist truly needs the cone, add a `ladder-pr` job that starts a SLICC leader (same as `ladder-build` slicc path) and run `cert/*.mjs` there — call those out in `cert/meta.json` `"harness": "slicc-realm"`. |

`ladder-pr`'s cert leg ([`scripts/browser-cert/cert-leg.mjs`](../scripts/browser-cert/cert-leg.mjs)) fails closed:

- A `host-node` or `host-smoke` harness must declare `ci:` commands. Without them, the leg fails with `<pkg>: cert harness <h> declares no ci commands; nothing was certified`. `ladder-pr` does not guess commands; the recipe declares them.
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
`packages/<name>/` triggers `ladder-pr` host-build for that recipe.

## Not CI-certified yet (blocked)

| Package | Blocker |
| --- | --- |
| cmake | host-build needs `slicc-emscripten` prebuilt `cmakemain.cxx.o`; use `scripts/smoke-cmake.mjs` (`harness: host-node`) once staged |
| findutils | 4.11.0 / gnulib getlocalename under emscripten; need `-exec`/`xargs -P` + wasm-coreutils |
| py-numpy / py-scipy / py-pandas | wasix stage/release 404 on Renovate bumps; import/numeric smoke under wasix-python once artifacts exist |

CI-certified set (automerge non-majors): see `scripts/ci-certified.json`
(jq, xz, pkgconf, xxd, coreutils, gawk, sed, gzip, git, grep, procps, which).

## py-* python range

A py-\* takes wasix-python as a range ([versioning.md](versioning.md#exact-ai-ecoverse-pins),
#702). Its `cert/meta.json` installs the **newest** python in `needsInstall`
(`@ai-ecoverse/wasix-python@<newest>`), so ladder-pr's browser cert runs on
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

### Peers: `"peers"` in `cert/meta.json`

`"peers": ["imagemagick", "imagemagick-heif"]` names other recipes whose
artifacts from the same `ladder-pr` run the cert job downloads, when they
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
is the harness's own spec. `kernel-compat-proof` runs it on npm `latest` of
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

## Kernel compatibility: `kernel-compat.yml`

`ladder-pr` runs a recipe's specs on the one kernel in its `cert/meta.json`.
[`kernel-compat.yml`](../.github/workflows/kernel-compat.yml) asks the other
question: do the **published** packages still pass their cert specs on kernel
X? slicc-kernel calls it on its PRs and releases; anyone can dispatch it.

```yaml
jobs:
  compat:
    uses: ai-ecoverse/homescoop/.github/workflows/kernel-compat.yml@main
    with:
      kernel: kernel-tgz
      set: base,ci-certified
```

| Input | Default | Meaning |
| --- | --- | --- |
| `kernel` | (required) | an npm spec (`@ai-ecoverse/slicc-kernel@1.85.1`, or a bare `1.85.1`), or the name of an artifact holding one kernel `.tgz`, uploaded earlier in the calling run |
| `set` | `base,ci-certified` | comma-separated: `base` and `catalog` (slicc-bios's base set and optional catalog, at the versions bios pins), `ci-certified` ([`scripts/ci-certified.json`](../scripts/ci-certified.json)), `all` (every recipe with `cert/*.mjs`), or recipe / npm names, `name[@version]` |
| `homescoop-ref` | `main` | the homescoop commit whose specs and scripts run |
| `bios-ref` | `main` | the slicc-bios commit whose `src/packages/package-lock.json` and `src/packages/optional/package-lock.json` give `base`, `catalog` and the **reference kernel** |
| `reference` | `''` | the **reference kernel** to compare against, instead of the one `bios-ref` pins: a published `@ai-ecoverse/slicc-kernel` version (`1.98.2`) or `@ai-ecoverse/slicc-kernel@<version or dist-tag>`. Nothing else is accepted: not git, file or URL specs, and not an artifact. A trusted run (see [Runners](#runners-and-capacity)) checks it like `kernel`, and an invalid one runs on `ubuntu-latest`, where `plan` refuses it. `base` and `catalog` still come from `bios-ref`. `compat.json`'s `reference.origin` (`input` or `slicc-bios`) and `inputs.reference` record the choice, and `summary.md` names it |
| `runner` | `''` | `runs-on` for the shards: `inputs.runner \|\| vars.CERT_RUNNER`, **only for a same-repo PR or a trusted run on main** (see [Runners](#runners-and-capacity)), else `ubuntu-latest` |
| `light-runner` | `''` | `runs-on` for plan and report: `inputs.light-runner \|\| vars.CERT_LIGHT_RUNNER`, else the shards' runner, under the same rule, else `ubuntu-latest` |
| `shards` | `auto` | shard jobs: `auto` (about 15 min of estimated work each, and more shards until none is over about 20 min, at most 10) or `1`–`10` |
| `fail-on-regression` | `true` | `false` reports regressions without failing |
| `expect-regressions` | `''` | a negative proof: recipes that must regress, in their spec and in the base sweep. The report fails if one doesn't; other regressions are listed but don't fail it |

Each package is the **published tarball** at the version bios pins (`base`,
`catalog`) or at npm's `latest` (`ci-certified`, `all`, a bare name), checked
against the lockfile's or the registry's `sha512` integrity. Recipes without
`cert/*.mjs`, `blocked` ones and `host-smoke` / `host-node` harnesses are
listed as skipped, as are base-set packages homescoop has no recipe for.

### Calling it from another repo

A PR of slicc-kernel packs its kernel, uploads it as an artifact and passes
the artifact's name; a release passes the published version.

```yaml
jobs:
  pack:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
      - run: npm ci && npm run build && mkdir -p out && npm pack --pack-destination out
      - uses: actions/upload-artifact@v7
        with:
          name: kernel-tgz
          path: out/*.tgz

  compat:
    needs: pack
    uses: ai-ecoverse/homescoop/.github/workflows/kernel-compat.yml@main
    with:
      kernel: kernel-tgz
      set: base,ci-certified
      fail-on-regression: false

  release-compat:
    needs: publish
    uses: ai-ecoverse/homescoop/.github/workflows/kernel-compat.yml@main
    with:
      kernel: '@ai-ecoverse/slicc-kernel@${{ needs.publish.outputs.version }}'
      set: all
      shards: '3'
```

- **The artifact** holds exactly one `.tgz` at its top level. Its name must
  not start with `@` or a digit: those are read as npm specs. It is found only
  in the calling run.
- **Outputs:** `needs.compat.outputs.verdict` (`pass`, `regression`, `error`),
  `regressions` (a count) and `artifact`, the name of the artifact with
  `compat.json`, `summary.md` and the logs. A release job downloads it with
  `actions/download-artifact` (`name: ${{ needs.release-compat.outputs.artifact }}`)
  and attaches `compat.json` to the GitHub release. The verdict table is also
  the run's job summary.
- **Non-blocking:** `fail-on-regression: false` keeps the job green and still
  reports the verdict; drop it (or make the check required) once it is
  stable.
- **Where it runs:** in the caller's run, on the caller's runners and
  minutes, with the caller's `CERT_RUNNER` / `CERT_LIGHT_RUNNER`. A pool
  runner is used only for a same-repo PR or a trusted run on main (below);
  a fork PR always gets `ubuntu-latest`. The called
  workflow asks only for `contents: read`; homescoop and slicc-bios are
  public, so the caller's token reads them.
- **Concurrency:** the called workflow has its own group per caller repo,
  PR (or ref), kernel, set and bios-ref, and a newer PR run cancels the
  older one. Don't give the caller's own `concurrency` the same group name.
- **Pinning:** `@main` follows homescoop's harness and limits. Pin a sha in
  `uses:` and `homescoop-ref` for a reproducible run, and `bios-ref` for a
  fixed base set and reference kernel. A pinned sha keeps the pool for a
  trusted event as long as it is on main (a merged commit, not a PR head).
- **Time:** `base,ci-certified` is a gate and a plan job (seconds each) and
  one shard of about 10 min. `all` is about 4 shards and `base,catalog,all`
  about 6, none over about 20 min, run side by side on the pool.

### Jobs

Hosted runners queue jobs for a long time (18–45 min a job on the org's pool
when it is busy), while the work is minutes, so a call runs as few jobs as it
can: a gate job, one plan job, the shard jobs (as many as keep each under
about 20 min), and a report job only when there is more than one shard. The gate and plan take seconds; on the light
pool each gets a machine within about a minute.

0. **gate** decides where the other jobs run (see
   [Runners](#runners-and-capacity)). It runs only the workflow file's own
   script, a GitHub API call for each sha ref, and checks nothing out, so
   it may run on the light pool for any event that could get the pool.

1. **plan** reads bios's lockfiles at `bios-ref` (through the GitHub API, at a
   recorded sha), resolves the candidate and the reference kernel (bios's pin
   of `@ai-ecoverse/slicc-kernel`), lists the packages and their versions,
   and reads the base-set tarballs' `slicc.commands` for the sweep. It packs
   the work into shard jobs by what it took in earlier runs
   ([`timings.json`](../scripts/browser-cert/timings.json)):
   - **`versions`**, per `recipe@version`: each spec file's seconds, how many
     runs a failing one took (the candidate, its retry, the reference, the
     reference's retry), and the setup each run pays (Chrome, the install
     into OPFS). A package whose estimate is over about 20 min is split by
     spec file into parts, each a unit of its own (the bios-pinned
     `wasix-python@3.14.2-16`: `discovery.mjs` in one part, the other
     specs in another). A version with no entry uses the cheapest measured
     version of its recipe, as if it passed;
   - **`seconds`**, per recipe and sweep mode: the fallback, then an
     estimate (10 s plus 4 s a spec; 2.5 min a sweep mode).

   With `shards: auto` it starts with one shard per about 15 min and adds
   shards (up to 10) until none is over about 20 min. Refresh the timings
   from runs' artifacts with
   `node scripts/browser-cert/compat.mjs timings --compat a/compat.json,b/compat.json`.
   `plan.json`, `candidate.tgz` and `reference.tgz` go to the
   `kernel-compat-<tag>-plan` artifact.
2. **shard** (matrix, on `runner` where allowed: 10 at once on the pool, 3 on
   hosted runners) runs its packages (or parts of them), then
   its sweep modes:
   - each package through `scripts/browser-cert/run.mjs --kernel
     candidate.tgz --users <meta.json users, else off>`, with `needsInstall` /
     `needs` / `needsTarballScripts` / `needsRepack` installed as `ladder-pr`
     does (a `needsRepack` peer whose recipe has no `repack.from` any more is
     installed at its published version, with a `::warning::`; exact-pins'
     `scripts/test/cert-needs.test.mjs` fails a PR that leaves one in a
     `cert/meta.json`, #600), with `--soft` (below). A failed case no known limit covers is
     retried once (one that passes the second time passes, marked flaky),
     then run on the reference kernel. Retries and reference runs repeat
     only the spec files with open failures (`run.mjs --spec`), not the
     whole package;
   - the **base-set sweep**, once per users mode (`report`, `enforce`): every
     base-set tarball but the kernel in one kernel, and
     [`base-sweep/sweep.mjs`](../scripts/browser-cert/base-sweep/sweep.mjs)
     run through `run.mjs` as root and as cone. Every command in their
     `slicc.commands` (`--version`, or the invocation in
     [`base-sweep/meta.json`](../scripts/browser-cert/base-sweep/meta.json))
     must exit as expected, plus grep, sed, xz, jq, find/xargs, diff/cmp and
     patch in real use. Failing commands are retried, then run on the
     reference.

   With a single shard, that job also writes the report.
3. **report** (more than one shard) merges everything into the
   `kernel-compat-<tag>` artifact (`compat.json`, `summary.md`, the logs) and
   the job summary.

### Verdicts

The unit is a **case**: one assertion of a spec, or one sweep command.

- **Cases:** under kernel-compat, `run.mjs --soft` records every `ctx.assert`
  call and goes on after a failed one, so one failure doesn't hide the next.
  A case is named by its call site in the spec (with the spec's helpers):
  `packages/rsync/cert/users.mjs:41<packages/rsync/cert/users.mjs:88`, plus
  `#n` for the nth time that line runs.
- **Crashes:** an exception that isn't an assertion (a `TypeError`, a page
  call that never answers) ends the spec. Its signature is where it happened
  plus the first line of the message, with numbers and URLs blanked out.

The verdicts:

- `pass`: the case passes on the candidate.
- `known`: it fails on the candidate, and either
  - a [`known-limits.json`](../scripts/browser-cert/known-limits.json) entry
    covers it, or
  - it fails the same way on the reference (the same case, or a crash with
    the same signature), or
  - the reference crashed before reaching it.
- `regression`: anything else. That means it passes on the reference, or
  the reference never reached it without crashing, or the candidate crashes
  where the reference didn't (or crashes differently). Only a regression
  fails the workflow, and so does an `error` (a shard that reported
  nothing).

A spec's verdict is its worst case. A spec with a known failure can still
regress in another case.

### `known-limits.json`

```json
{
  "limits": [
    {
      "package": "@ai-ecoverse/wasm-coreutils",
      "spec": "base-sweep",
      "case": "[",
      "kernel": "*",
      "rc": 127,
      "issue": "ai-ecoverse/slicc-kernel#530",
      "why": "the kernel's command catalog drops '['"
    }
  ]
}
```

`package` is the npm name (or the recipe dir), `spec` the spec file or
`base-sweep`, `case` the sweep's command (exact) or, for a spec, a regex the
failure text must match. `kernel` and `version` are ranges (`>=1.36.0
<1.73.3`, `||`, `*`); `users`, `user` and `rc` narrow it further. A matching
limit makes a failure `known` even when the case passes on the reference, so
keep each one to its case and range.

**Rules for entries:**

- **An entry needs an issue.** Every entry names the issue (or the PR) that
  fixes it. An entry whose range is still open (`*`, or no upper bound)
  needs that issue to be open.
- **When the fix ships, the entry stops matching it.** Close the range at the
  release with the fix (`>=1.78.0 <1.86.0`, `version: <1.0.8-2`), so it never
  covers a kernel or a build that has the fix, or remove the entry. A closed
  range stays only while kernel-compat still runs on what it describes: a
  package version bios pins, or a kernel the proof uses.
- **Never green a candidate's regression with one.** A regression found on a
  candidate kernel is a FAIL. Report it to the Kernel Coordinator (or the
  package's owner) and leave it red. An entry for a kernel issue comes only
  once that issue is filed, and only for the kernels already released with
  it.
- **Expected behaviour is not a limit.** A command that is meant to exit
  non-zero (`false`, `bzip2recover` without arguments, `chcon` and `runcon`
  without SELinux) gets its `rc` in `base-sweep/meta.json`'s `invocations`
  instead.
- **New entries and changes go to the Recipe Manager for review.**

### `compat.json`

```text
{ kernel: { spec, name, version, sha256, integrity, gitHead, source },
  reference: { spec, version, sha256, gitHead, source },
  homescoopRef, biosRef, inputs, run: { repository, sha, event, id, url },
  verdict: pass | regression | error,
  summary: { pass, known, regression, skip, error, sweep: {…}, regressions },
  results: [{ package, recipe, version, sha256, spec, users, status: pass|fail|skip,
              verdict, durationMs, assertions, log, flaky?, error?, reference?,
              cases?: [{ id, kind: case|crash|spec, message, verdict, reference: pass|fail|crash|unreached,
                         why?, limit?, flaky? }] }],
  packages: [{ id, package, version, sha256, origin, users, modes, status, verdict, durationMs, peers, reference }],
  sweep: [{ users, user, command, package, recipe, version, argv, rc, expected, status, verdict, out, reference?, limit? }],
  shards: [{ shard, packages, wallMs, runner }], sweeps: [{ mode, wallMs, runner }] }
```

### File modes

`run.mjs` writes each package straight to OPFS, as an installer does. Such
files get the kernel's defaults: directories `0755`, files `0644`, files under
`node_modules/*/bin/` `0755`. With slicc-kernel ≥ 1.86.0 it then gives every
file whose tarball mode isn't `0644`, and every `bin/` file, its tarball mode
with `kernel.chmod`, as bios's installer does with `writeMetadata`. Under
users `enforce` a shim or helper that runs by path (wasi-pnpm's `shims/npm`,
git's `libexec/git-core/*`) needs that x bit. Older kernels have no
`kernel.chmod` and keep the defaults. `--json` and `compat.json` say which
(`modes: tarball` or `kernel defaults`).

**Modes and the reference kernel:** a reference before 1.86.0 has no
`kernel.chmod`, so it runs with the default modes. A package that ships a
wrong mode (a `bin/` file `0644`) passes there and fails on a candidate that
stamps the tarball's modes, which kernel-compat reports as a regression.
That is the package's bug: add a known limit scoped to the versions before
the fix (as for `wasm-coreutils` before 9.12.0-6, #332).

**The owner gap:** only modes are stamped, not owners. bios's installer
writes its files before the first boot and stamps them with `writeMetadata`
(`@ai-ecoverse/slicc-kernel/meta`), which can also set `uid` and `gid`. The
harness writes after boot, so its files carry no owner record and get the
kernel's defaults. A spec whose result depends on an installed file's owner
under `enforce` may differ from bios; bios's integration tests and P3's
canary are the authority there. Closing the gap means writing the packages
before boot and stamping modes and owners with `writeMetadata`, which
changes the boot order for every cert.

### `run.mjs` flags

| Flag | Meaning |
| --- | --- |
| `--kernel <spec \| .tgz \| dir>` | the kernel to boot instead of `HOMESCOOP_CERT_NODE_MODULES`'s (which `ladder-pr` fills from `meta.json`'s `kernel`, else the `@ai-ecoverse/slicc-kernel` devDependency in the root `package.json`: [`cert-kernel.mjs`](../scripts/browser-cert/cert-kernel.mjs), which logs which one it took) |
| `--users off\|report\|enforce` | overrides `meta.json`'s `users`; without either the kernel's default applies (`enforce` since 1.74, `off` before) |
| `--tarball <tgz>` (repeatable) | the packages under test, installed in this order; the first is `ctx.npmName`. Specs see every manifest in `ctx.installed` |
| `--cert <dir>` | the spec directory (default `packages/<package>/cert`). Its `meta.json` sets `needs`, `users`, `uplink` and the rest; a directory without one (a reviewer's own spec) takes `packages/<package>/cert/meta.json`, and the log says which file it read (`browser-cert: meta …`) |
| `--json <file>` | per-spec results: `{ meta, kernel, users, modes, tarballs, specs: [{ spec, status, durationMs, error, cases: { pass: [id], fail: [{ id, message }] }, crash? }], pageErrors, status }` |
| `--soft` | a failed `ctx.assert` is recorded and the spec goes on (kernel-compat); without it the first failure ends the spec, as `ladder-pr` wants |
| `--spec <file.mjs>` (repeatable) | run only these spec files of the cert directory |
| `--live <port>` | boot and install as usual, then keep Chrome open (with a window when `DISPLAY` is set) and serve the specs' `ctx` on `http://127.0.0.1:<port>/`: `GET /` describes it, `POST /ctx/<call>` with a JSON array of arguments calls `run`, `write`, `read`, `pty`, `addUser` and the rest. `cert-review` uses it for its live pairs |

### Runners and capacity

- A reusable workflow runs **in the caller's run**: slicc-kernel's calls use
  its runs, its `vars.CERT_RUNNER` and its minutes, not homescoop's. GitHub's
  concurrent-job limit for hosted runners is per organization, so they still
  share that pool with `ladder-pr`; hence the bounds below.
- `concurrency`: one group per caller repo, PR (or ref), kernel, set,
  bios-ref and reference; a PR caller's newer run cancels the older one.
- One call is a gate, a plan, up to 10 shards and a report job. On the pool
  10 shards run at once (cloud-run-bench has up to 30 machines); on hosted
  runners 3, so a fork PR's call doesn't crowd out `ladder-pr`. The usual
  `base,ci-certified` call is a gate, a plan and one shard job.
- **No fork PR code on a pool.** A job on a Cloud Run pool (`cloud-run`,
  `cloud-run-bench`) can reach the GCP metadata server and the pool's
  service-account token. `runner` / `CERT_RUNNER` (shards) and
  `light-runner` / `CERT_LIGHT_RUNNER` (plan, report) are used only for:
  - a `pull_request` from a branch of the calling repo (`head.repo` is
    `github.repository`): our agents' branches and Renovate. This includes
    this repo's proof and slicc-kernel's PR calls; or
  - `schedule`, `workflow_dispatch`, `workflow_run` or `release` on
    `refs/heads/main` (the caller's ref, for a call), with:
    - `kernel` a published `@ai-ecoverse/slicc-kernel@<version>`, a bare
      `<version>`, or the name of a kernel `.tgz` artifact uploaded earlier
      in the same calling run, which is the caller's trusted main run (a
      name that starts with neither `@` nor a digit; the gate logs
      `artifact kernel <name> from a main run → pool`). An npm-shaped value
      that isn't a published slicc-kernel version (another package, git,
      file) still runs hosted;
    - `reference`, if set, a published slicc-kernel version or dist-tag;
    - `homescoop-ref` either `main` or a full 40-hex sha that is on
      homescoop's main, and `bios-ref` either `main` or a full sha on
      slicc-bios's main. The gate job checks a sha with the compare API
      (`compare/main...<sha>` is `behind` or `identical`).

  Anything else runs on `ubuntu-latest`, whatever `runner` says: fork PRs,
  `pull_request_target`, `merge_group`, dispatches from another ref, a
  branch name, short sha or unmerged sha as `homescoop-ref` / `bios-ref`, or
  a failed check. The gate job logs which, and why. `runs-on` can't check a
  sha, so the gate's own `runs-on` checks only the event and ref (a
  same-repo PR, or a trusted event on main) and it runs nothing from the
  refs it checks; plan, shards and report run where it says.
  The org requires approval before an outside contributor's workflow runs,
  and agents never approve one.
  `compat.mjs plan` also takes only registry versions and dist-tags for the
  kernel and for `name@version` in `set`, so `npm pack` never fetches a git
  or file spec.
  The check lives in the workflow file, so a fork PR could change it in its
  own copy. That is why the org's approval of outside contributors' runs is
  the backstop.
- Gate, plan and report use `light-runner` / `CERT_LIGHT_RUNNER`
  (`cloud-run`, 4 vCPU / 8 GiB), else the shards' runner. The shards use
  `runner` / `CERT_RUNNER` (`cloud-run-bench`). On the pool a job gets a machine within about a minute, where
  `ubuntu-latest` can queue for 15–40.
- **No root on the pool.** Its machines run with "no new privileges", so
  `sudo` cannot become root. The Chromium step installs the system libraries
  (`playwright-core install --with-deps`) only where `sudo -n true` works and
  the runner isn't `cloud-run-*`; the runner-bench image already has
  Chrome's libraries and fonts, so there it installs the browser only.
  Nothing else in kernel-compat needs root: users exist only inside the
  kernel.
- Shards are short and re-runnable ("Re-run failed jobs" uploads with
  `overwrite`).
- Nothing here publishes: `ladder-merge` dispatches `ladder-build` only for
  pushes to `packages/**`, and these files live under `scripts/` and
  `.github/workflows/`.

### Proof

[`kernel-compat-proof.yml`](../.github/workflows/kernel-compat-proof.yml) runs
on PRs that touch these files, the harness itself (`run.mjs`,
`context.mjs`, `page/`) or the root `package.json` (a pin bump): `ladder-pr` runs no package cert on a scripts-only
PR, so this is the harness's regression test. It calls the workflow twice, as slicc-kernel
does, on the kernels the root `package.json` pins as devDependencies: the
certified kernel (`@ai-ecoverse/slicc-kernel`; Renovate bumps it) on
`base,ci-certified` must be green, and the old one (`slicc-kernel-negative`,
an npm alias of `@ai-ecoverse/slicc-kernel@1.78.0`) with `expect-regressions: grep,sed,xz,jq,findutils,diffutils,patch`
must report a regression, in a spec and in the sweep, for each of them: the
Emscripten builds without `slicc_sleep_ms` that exit 70 there
(slicc-kernel#483, fixed by #496 in 1.81.0).

The `@ai-ecoverse/slicc-kernel` pin must be a certified kernel, and `ci` enforces it: `ladder-pr`'s `exact-pins` job runs [`check-cert-kernel.mjs`](../scripts/check-cert-kernel.mjs), which fails unless the pin is exact, its slicc-kernel release `v<pin>` has a `certified @ai-ecoverse/slicc-kernel@<pin> sha256=<hex>` line, and the registry tarball re-hashes to that sha256.

## Cert review: `cert-review.yml`

Claude reviews every package a same-repo PR builds, after `ladder-pr` finishes, and leaves a verdict.

- **When:** `workflow_run` on a completed `ladder-pr` run for a same-repo pull request (never a fork's), or `workflow_dispatch` with `pr_number`. The plan job (`CERT_LIGHT_RUNNER`) uses only the `ladder-pr` run at the PR's current head; a PR that has moved on waits for its new run.
- **What Claude gets** (`CERT_RUNNER`): the head checked out, the `host-<package>-prN` tarballs from that run, a cert harness per package (`scripts/cert-review/harness.sh`, the same setup as `ladder-pr`'s cert job: the kernel from the head's `scripts/browser-cert/cert-kernel.mjs`, shared-web and playwright-core from its `package.json` pins through `scripts/dev-pin.mjs`, or the old inline versions for a head that predates them), `gh` to read `ladder-pr`'s logs, and `cert-run`, which runs package code without the Bedrock key or the GitHub token. It checks the change, re-runs specs on other kernels and under `--users enforce` as needed, and writes `verdict.json` (`certified` or `fail` per package, with known issues) and `comment.md`.
- **The record:** a separate `record` job on a fresh runner, the only one with `statuses` and `pull-requests` write, takes Claude's `verdict.json` and `comment.md` as data, downloads the `ladder-pr` artifacts itself, and runs `scripts/cert-review/verdict.mjs` from the workflow's own commit, never the PR's. It computes each `certified=<sha256> <@scope/name> <version>` line from the artifact; Claude never writes a sha, and a `ladder-pr` run that didn't conclude `success` is never certified (`cert-ci: HELD`). The job posts the comment, uploads the `cert-review-record-<pr>` artifact (`record.json`: `pr`, `head`, `ladder_run`, `cert_review_run`, the result `lines`, and `no_cert_specs`: the packages with no `packages/<pkg>/cert/*.mjs` at the head, whose lines also say "no committed cert specs; this certification rests on the reviewer's own run"), and sets a `cert-review` commit status on the PR head whose `target_url` is that record artifact (`…/actions/runs/<run>/artifacts/<id>`): `success` only when every built package is certified. It is a status, not a check run, because a check run created through the API joins the commit's existing GitHub Actions check suite, `ladder-pr`'s.
- **A repack's input must be attested** (cert lane rule, 2026-10-16, from #730). Before the verdict, the `record` job runs `scripts/cert-review/repack-input.mjs` on each built package. For a recipe with `repack: from:` it follows the chain back through the published versions (a version is a repack if the `recipe.yaml` in its tree has `repack:`) to the first version that was actually built, the root. Every version in the chain needs an npm provenance attestation for its own sha512 from `ai-ecoverse/homescoop`'s `ladder-build.yml` on `refs/heads/main`; the root also needs, in the tree at its attested commit, a `source.sha256` pin, a build that `homescoop_fetch`es that source (its sha argument is `$SRC_SHA`/`$SHA`, which `homescoop_load_recipe` exports from `source.sha256`, or the same literal; a fetch of something else doesn't count), and no way to stage a prebuilt artifact instead of compiling: no env-overridable `*_STAGE`, `*_WHEEL`, `*_PREBUILT`, `*_RELEASE_URL` or `*_ARTIFACT` input, no tree outside the repo (`$ROOT/..`), no download of homescoop's own releases. These rules read build.sh and every repo script it runs or sources, recursively (depth cap 8): `scripts/*.sh`, package-local helpers (`$HOMESCOOP_PKG/<x>.sh`, `$(dirname "$0")/<x>.sh`, `./<x>.sh`, `bash <x>.sh`); an explicit reference that isn't in the tree fails closed. That last rule is static because no run records which path it took. A root without provenance can still count through `--reproduced` (a matching `dist.integrity` from an independent rebuild). Otherwise `verdict.mjs` writes `cert-ci: INCOMPLETE <name>@<version>: unverifiable input: <reason>`, whatever the reviewer said, and the package isn't certified; a trace that couldn't run is INCOMPLETE too. The result is `repack-input.json` in the record artifact. Run it locally with `node scripts/cert-review/repack-input.mjs --package <recipe> [--ref <commit>]`.
- **The root rule for every build, not just repacks** (cert lane ruling on #858/#859, audit #864). For a recipe with no `repack:`, the same `repack-input.mjs` run applies the root's static rule to the recipe and build scripts at the reviewed head: a `source.sha256` pin that a `homescoop_fetch` of `$SRC_SHA`/`$SHA` (or the literal) fetches, and no stage or prebuilt path. Its JSON is `{ "repack": false, "built": true, "attested": true|false, "reason": … }`, and `verdict.mjs` passes a package only with `attested: true`, so a built recipe that fails is `INCOMPLETE … unverifiable input: <reason>` as well. A recipe whose source is committed here declares `source:` / `in-tree: "<paths under packages/<pkg>/>"` instead of `url`/`sha256`. That declaration is verified, never trusted: each path must be in the judged tree; the package's own build files (`packages/**/*.sh`; the shared `scripts/*.sh` installers check their own pinned sha256) must download nothing a pinned sha256 or lockfile doesn't cover. That rules out `curl`, `wget`, `git clone`/`fetch`, `homescoop_fetch` without a literal sha256, `pip install` without `--require-hashes`, `npm install`/`npx`/`pnpm add`/`yarn add` (allowed: `npm ci`, `--frozen-lockfile`), `cargo install`/`build`/`fetch` without `--locked`/`--frozen`/`--offline`, `go install`/`go get`, `rustup` installs, and system package managers. The prebuilt rule also applies. A declaration that fails is INCOMPLETE. Script references are followed per package: a loop variable naming the package (`for r in a b; do bash "$HOMESCOOP_ROOT/packages/$r/build.sh"`) is expanded for each word, and once-assigned path variables in a package's own files are substituted. A loop variable that's also assigned elsewhere, a package name held in any other variable, or a variable reference that would resolve to the referencing file itself, all fail closed. A `$SRC_SHA`/`$SHA` fetch counts for the recipe only in its own `packages/<pkg>/` files and the shared `scripts/`, or in a followed `packages/<other>/` whose recipe pins the same sha256. Every followed `packages/<other>/` must pin and fetch its own source.
- **Live pairs:** before Claude starts, a step with no secrets starts two `run.mjs --live` harnesses per package under Xvfb, with users enforced on the `cert/meta.json` kernel: npm `latest` (the baseline, from 9300) and the PR's tarball (from 9301), listed in `$RUNNER_TEMP/live/live.json`. Claude runs the same thing on both: a failure the baseline shares is pre-existing, never blocks, and gets an issue filed.
- **Severity:** roll forward. FAIL only for security or secret exposure, data loss, a supply-chain mismatch, a licence violation, a crash, or a regression without a workaround; anything else certifies with `(known: …)`.
