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

## Patch ↔ spec mapping

Every `packages/<name>/*.patch` must be named in `cert/meta.json` under
`patches`, with a cert case that exercises the patched code path. Specs that
only smoke `--version` are not enough for patched packages.

## Enabling automerge

1. Port the checklist into `cert/` (and map every patch in `meta.json`).
2. Negative proof in `cert/NEGATIVE.md`:
   - **With patches:** rebuild once with the SLICC patch removed; the cert
     case that maps to that patch (or the build) must fail. Record the log.
   - **Without patches:** `prove-negative.mjs` (empty `.wasm`) plus an
     in-spec wrong-output / non-zero-exit assert.
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

### Time per call: `"runTimeoutMs"` in `cert/meta.json`

Each page call (`ctx.run`, `ctx.write`, …) has to answer within 120 s, or the spec fails with `Runtime.evaluate: no answer in … ms`. `"runTimeoutMs"` changes that for one package. The harness's own default was 30 s, which wasix-python's venv and pnpm-layout steps outgrew on slower CI runners.

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
| `runner` | `''` | `runs-on` for the shards and the sweep: `inputs.runner \|\| vars.CERT_RUNNER \|\| 'ubuntu-latest'` |
| `shards` | `auto` | shard jobs: `auto` (about 15 min of estimated work each, at most 3) or `1`–`3` |
| `fail-on-regression` | `true` | `false` reports regressions without failing |
| `expect-regressions` | `''` | a negative proof: recipes that must regress, in their spec and in the base sweep. The report fails if one doesn't; other regressions are listed but don't fail it |

Each package is the **published tarball** at the version bios pins (`base`,
`catalog`) or at npm's `latest` (`ci-certified`, `all`, a bare name), checked
against the lockfile's or the registry's `sha512` integrity. Recipes without
`cert/*.mjs`, `blocked` ones and `host-smoke` / `host-node` harnesses are
listed as skipped, as are base-set packages homescoop has no recipe for.

### Jobs

Hosted runners queue jobs for a long time (18–45 min a job on the org's pool
when it is busy), while the work is minutes, so a call runs as few jobs as it
can: one plan job, 1–3 shard jobs, and a report job only when there is more
than one shard.

1. **plan** reads bios's lockfiles at `bios-ref` (through the GitHub API, at a
   recorded sha), resolves the candidate and the reference kernel (bios's pin
   of `@ai-ecoverse/slicc-kernel`), lists the packages and their versions,
   and reads the base-set tarballs' `slicc.commands` for the sweep. It packs
   the work (each package about 10 s plus 4 s a spec, each sweep mode about
   2.5 min) into `shards` jobs. `plan.json`, `candidate.tgz` and
   `reference.tgz` go to the `kernel-compat-<tag>-plan` artifact.
2. **shard** (matrix, `max-parallel: 3`, on `runner`) runs its packages, then
   its sweep modes:
   - each package through `scripts/browser-cert/run.mjs --kernel
     candidate.tgz --users <meta.json users, else off>`, with `needsInstall` /
     `needs` / `needsTarballScripts` / `needsRepack` installed as `ladder-pr`
     does. A failure is retried once (a spec that passes either time passes,
     marked flaky); a failure no known limit covers is run again on the
     reference kernel;
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

- `pass`: the spec (or sweep case) passes on the candidate.
- `known`: it fails on the candidate, and a
  [`known-limits.json`](../scripts/browser-cert/known-limits.json) entry covers
  it or it fails on the reference kernel too.
- `regression`: it fails on the candidate and passes on the reference. Only
  this fails the workflow, and so does an `error` (a shard that reported
  nothing).

A spec is the unit, so a spec file that already fails on the reference hides
a second failure in the same file; its log is in the artifact.

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
              verdict, durationMs, log, flaky?, error?, limit?, reference? }],
  packages: [{ id, package, version, sha256, origin, users, status, verdict, durationMs, peers, reference }],
  sweep: [{ users, user, command, package, recipe, version, argv, rc, expected, status, verdict, out, reference?, limit? }],
  shards: [{ shard, packages, wallMs, runner }], sweeps: [{ mode, wallMs, runner }] }
```

### `run.mjs` flags

| Flag | Meaning |
| --- | --- |
| `--kernel <spec \| .tgz \| dir>` | the kernel to boot instead of `HOMESCOOP_CERT_NODE_MODULES`'s (which `ladder-pr` fills from `meta.json`'s `kernel`, still the default) |
| `--users off\|report\|enforce` | overrides `meta.json`'s `users`; without either the kernel's default applies (`enforce` since 1.74, `off` before) |
| `--tarball <tgz>` (repeatable) | the packages under test, installed in this order; the first is `ctx.npmName`. Specs see every manifest in `ctx.installed` |
| `--cert <dir>` | the spec directory (default `packages/<package>/cert`) |
| `--json <file>` | per-spec results: `{ kernel, users, tarballs, specs: [{ spec, status, durationMs, error }], pageErrors, status }` |

### Runners and capacity

- A reusable workflow runs **in the caller's run**: slicc-kernel's calls use
  its runs, its `vars.CERT_RUNNER` and its minutes, not homescoop's. GitHub's
  concurrent-job limit for hosted runners is per organization, so they still
  share that pool with `ladder-pr`; hence the bounds below.
- `concurrency`: one group per caller repo, PR (or ref), kernel, set and
  bios-ref; a PR caller's newer run cancels the older one.
- One call is at most 1 + 3 + 1 jobs, `max-parallel: 3`; the usual
  `base,ci-certified` call is a plan job and one shard job.
- Set `CERT_RUNNER` to `cloud-run-bench` (the org's Cloud Run pool) to move
  the heavy jobs off GitHub-hosted runners without a code change; plan and
  report stay on `ubuntu-latest`. Shards are short and re-runnable ("Re-run
  failed jobs" uploads with `overwrite`).
- Nothing here publishes: `ladder-merge` dispatches `ladder-build` only for
  pushes to `packages/**`, and these files live under `scripts/` and
  `.github/workflows/`.

### Proof

[`kernel-compat-proof.yml`](../.github/workflows/kernel-compat-proof.yml) runs
on PRs that touch these files or the harness itself (`run.mjs`,
`context.mjs`, `page/`): `ladder-pr` runs no package cert on a scripts-only
PR, so this is the harness's regression test. It calls the workflow twice, as slicc-kernel
does: `@ai-ecoverse/slicc-kernel@1.81.0` on `base,ci-certified` must be green,
and `1.78.0` with `expect-regressions: grep,sed,xz,jq,findutils,diffutils,patch`
must report a regression, in a spec and in the sweep, for each of them: the
Emscripten builds without `slicc_sleep_ms` that exit 70 there
(slicc-kernel#483, fixed by #496 in 1.81.0).
