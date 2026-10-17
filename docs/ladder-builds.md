# Ladder builds

Homescoope publishes `@ai-ecoverse/wasm-*` in the ImageMagick delegate order.
Each recipe declares **where** it builds:

| `builder` | Script | Where | Emcc |
| --- | --- | --- | --- |
| `slicc` | `build.jsh` | SLICC cone via `packages/github-workflow` | In-cone `/emscripten/slicc` (or future `@ai-ecoverse/emcc`) |
| `host` | `build.sh` | GHA runner (or a laptop) | Native toolchain (`emsdk` npm / system emcc) |
| `retired` | — | — | Not built or published (kept for history / cleanup) |

Default is **`slicc`**. Flip a recipe to `host` when you want the runner
path (e.g. before in-cone emcc is ready). The dual-script framework is
always present; CI only runs the script matching `builder`.

## Flow (`ladder-build.yml`)

```text
workflow_dispatch(package)
  └─ read recipe.builder + npm version
       ├─ npm view pkg@version exists → log "already published, skipping"
       │                                 (no build, no publish)
       ├─ slicc → start-leader → ipk mamba / ipk add deps → build.jsh →
       │          pack → fetch tgz → OIDC publish
       └─ host  → npm i emsdk → (npm deps only) → build.sh → npm pack →
                  OIDC publish
```

A recipe change that needs a new WASM must bump the packaging revision (`X.Y.Z-N`).
The same `pkg@version` on the registry is never rebuilt.

**Publish order:** `ladder-pr` runs host-build, host-smoke, and
`packages/<name>/cert/*.mjs` on slicc-kernel CDP (see [ci-cert.md](ci-cert.md)).
Packages in `scripts/ci-certified.json` may Renovate-automerge non-majors;
`ladder-merge` then OIDC-publishes the exact PR artifact
(`certified=<sha256>` + `artifact_pr` + `artifact_id`). Majors / unlisted packages stay manual.

**Publish gate (`scripts/ladder-merge-resolve.mjs`).** Each touched package
maps to the newest first-parent commit of the pushed range that touched it,
and to the PR merged as that commit. When the merged `package.json` version
is not on npm, `ladder-merge` needs the `host-<pkg>-prN` artifact from a
ladder-pr run at that PR's merged head that concluded `success`, and one of:

- a `certified=<sha256> <@scope/name> <version>` line naming that package
  and version, whose sha equals the artifact's `package.tgz`. The merge
  commit message is read first, then the PR body. Lines count only when the
  PR's author can write to the repository, since GitHub can fill the merge
  message from PR text. Third comes the CI cert review: the newest
  `cert-review` commit status on the merged head from `github-actions[bot]`,
  if it is `success`, its `target_url` and description name the same run
  and record artifact, the run is main's `cert-review.yml` (`workflow_run`
  or `workflow_dispatch`, concluded `success`), and that artifact is the
  run's `cert-review-record-<pr>`, naming this PR, this head and that run. Its lines need no writer, since main's workflow produced them. Within
  the source it resolves from, another line naming the package at a
  different version fails; or
- no line for the package, the package in `scripts/ci-certified.json`, a PR
  by `renovate[bot]` or by a writer (a fork can't vouch for its own
  ladder-pr run, whose workflow file it controls), that run's `ci` job
  green, and no `cert-review` status of `failure` or `error` on the head (a
  failed review vetoes; an absent or pending one doesn't).

Anything else (no line, a wrong version or malformed sha, a stale head, a
failed run, an expired or missing artifact, a sha mismatch) fails the
package red and dispatches nothing. Versions already on npm dispatch plain
`package=<name>` and ladder-build skips them. `ladder-build` fetches the
artifact by `artifact_id` and checks `certified` again; it publishes only
when dispatched on `main`.

Dry run: `gh workflow run ladder-merge.yml -f sha=<full merge commit sha>` resolves
and prints the decision without dispatching. `before`, `packages`,
`assume_unpublished`, `message`, `pr_body`, `pr`, `head` and `ci_certified`
simulate the other cases (`pr` resolves an open PR, with `sha` its head).

**After the publish** ladder-build polls the registry for up to thirty minutes
(`scripts/verify-published.mjs --timeout 1800`) until `dist.integrity` of the
version shows up, and requires it to equal the sha512 of the exact
`package.tgz` it published. The window only covers a version that isn't
visible yet: the first version of a new, 22 MB package took about 18 minutes
(homescoop#686). A visible version with another integrity fails at once. A
mismatch, or a version that never appears, fails the job and
opens (or comments on) one `publish-failure` issue naming the package,
version, run and both values. It publishes with `--tag latest` only: for
homescoop, certified = latest.

**Auto-merge (`ladder-automerge.yml`).** When a `cert-review` run completes
(or on `workflow_dispatch` with a PR number), ladder-automerge re-derives
everything from the PR and merges it with a merge commit at its head only if
it is open, from this repo, not a draft, based on `main`, not labelled
`homescoop-major` and no recipe goes up a semver major; its newest
`cert-review` status is a valid record on the head (the resolver's own
binding); ladder-pr's run at the head and its `ci` job are green; it touches
publishable package files and none of `.github/workflows/**`, `scripts/**`,
`shims/**`, `crates/**`, `renovate.json` or the root `package.json`; and
`mergeable_state` is `clean`. Every check runs again right before the merge. A merge
with `GITHUB_TOKEN` starts no `push` workflows, so the same run then calls
`ladder-merge.yml` (`workflow_call`) for the merge commit; ladder-merge
dispatches for real only on a push to `main` or when that caller is main's
ladder-automerge, and the resolver re-checks every binding. A skipped PR
with a green review gets one `auto-merge skipped: <reason>` comment (updated
on re-runs) and the reason in the job summary; a failed merge comments on a
`publish-failure` issue. A `GITHUB_TOKEN` merge fires no `Closes #N`, so
after a merge the job closes the PR's still-open same-repo
`closingIssuesReferences` itself (`Closed by #PR (merge <sha>), merged by
ladder-automerge.`); a close failure is a warning. When `main` has a merge
queue, ladder-automerge doesn't merge (the queue rejects a direct merge): it
enables auto-merge with a merge commit at the decided head
(`enablePullRequestAutoMerge`, `expectedHeadOid`; `enqueuePullRequest` if
GitHub answers that the PR is already in clean status), and the publish runs
from the queue's push to `main`, see *Merge queue* below. Without a queue,
enabling auto-merge on a clean PR is refused, so it merges directly as above;
the same code works before and after the ruleset. Dispatched from any branch but `main`,
ladder-automerge is a dry run: it prints the decision and calls ladder-merge
dry. Runs are serialized repo-wide (`concurrency: ladder-automerge`); GitHub
keeps only the newest pending run, so a PR whose run was replaced is picked
up by `workflow_dispatch` or its next review.

**Chain depth.** ladder-pr → cert-review → ladder-automerge is three
`workflow_run` levels, GitHub's limit. Nothing may hang a fourth
`workflow_run` off ladder-automerge: its publish runs inside the same run
(`workflow_call`), and ladder-merge reaches ladder-build by
`workflow_dispatch`, which starts a new chain.

**Manual:** laptop `npm publish` of the exact certified tarball, then land,
or `gh workflow run ladder-build.yml -f package=… -f certified=<sha>`.

OIDC publish always runs **on the runner** (`id-token: write`). One workflow
file (`ladder-build.yml`) keeps a single `npm trust` target.

`workflow_dispatch` input `publish` (default `true`) is the cert-queue valve:
set `publish=false` on a PR branch to produce `package-tgz-<name>` without
writing the registry. `ladder-merge` omits the input. A dispatch on any ref
other than `main` never reaches the publish job, whatever `publish` says.
`ladder-pr` host-builds also upload that artifact (no OIDC). When
`publish=false`, skip-if-already-published is ignored so a rebuild can still
emit a tarball for recert.

If `pkg@version` is **not** on npm, OIDC publish is refused unless dispatch
sets `certified=<sha256>` and that digest matches the built tarball
(`scripts/assert-certified-publish.mjs`). Land-before-publish therefore
cannot ship an uncertified rebuild even with a trusted-publisher binding.
When the version document already exists, publish is skipped (success).

## PR and merge automation

| Workflow | When | What |
| --- | --- | --- |
| `ladder-pr.yml` | pull_request; `merge_group`; `workflow_dispatch(group_head)` (group dry run) | Host-build each touched package (no publish); on a merge group, check the combined head without building |
| `ladder-automerge.yml` | `cert-review` completed (`workflow_run`), or `workflow_dispatch(pr)` | Hand a green, certified, package-only PR to the merge queue (with no queue: merge it, then call `ladder-merge.yml` for the merge commit) |
| `ladder-merge.yml` | push to `main` under `packages/**`, or `workflow_call` from ladder-automerge (`workflow_dispatch`: dry run) | Gate, then `workflow_dispatch` each touched package on `ladder-build.yml` |
| `ladder-build.yml` | `workflow_dispatch` only | Single-package build; OIDC publish unless `publish=false` |

`ladder-merge` must **not** `uses:` `ladder-build` as a reusable workflow: npm
OIDC validates the *calling* workflow filename, and fledgling trusts only
`ladder-build.yml`. Merge therefore calls `createWorkflowDispatch` so each
publish runs as a real `ladder-build` workflow.

`scripts/list-touched-packages.mjs` maps changed paths → recipe names.
`ladder-merge` passes `--publishable` so only `recipe.yaml` or `package/`
dispatches a build/publish; a `build.sh`-only merge does not republish.
`ladder-pr` host-build uploads `package.tgz` + sha256 as artifacts, runs
`packages/<name>/smoke.c` via `scripts/host-smoke.sh` when present, then
**browser-cert** for emscripten CLIs: Chromium + `@ai-ecoverse/slicc-kernel`
via `@ai-ecoverse/slicc-shared-web/harness` CDP
(`scripts/browser-cert/run.mjs`). Optional
`packages/<name>/browser-cert.json` sets `argv` / expected `stdout`; default
is `<command> --version`. Libs without `slicc.commands` skip browser-cert
(host-smoke is the gate). Green ladder-pr is the Renovate automerge signal.
`scripts/sync-package-version.mjs` sets `package.json` version from the
recipe when Renovate bumps upstream (leaves existing `X-N` packaging revs).
ladder-pr's `recipe-sha` job commits that sync onto the PR, so main never
needs it: `ladder-build`'s resolve runs `sync-package-version.mjs <pkg>
--check` and fails, before any build or publish, when the committed version
base or `homescoop.upstream` disagrees with `recipe.yaml`, naming both
values.

### Merge queue

`main` merges through a merge queue (merge commits only, ALLGREEN, at most
3 entries). `gh pr merge N --auto --merge --match-head-commit <sha>`
enqueues the PR once its own checks are green; the required check is
ladder-pr's `ci`.

**What a group runs.** The queue builds `gh-readonly-queue/main/pr-N-…`, one
merge commit per queued PR on top of `main` (each PR head is the second
parent), and fires `merge_group`. ladder-pr then builds **nothing**, pushes
nothing and uploads nothing: `recipe-sha`, `host-build` and `rebuild` (and
everything after them) run on `pull_request` only, and publishing stays on
the push to `main`. It runs what a combined head can change:

- `exact-pins`: the exact pins, the cert kernel and every
  `scripts/test/*.test.mjs` check, on the group head. These are the checks
  that caught both crossings of 10-16 (#814 with #816, #854 with
  reproducible-optin).
- `detect`, on the group's range from `main`.
- `group` (`scripts/merge-group-check.mjs`): from `main` to the group head,
  every first-parent commit must be a two-parent `Merge pull request #N`
  commit whose PR is open with that second parent as its head (so what's queued is
  the head that was checked). For each package a member touches (recipe
  `inputs:` included), it fails the group:
  - when two queued PRs touch the package, since no artifact was built from the combined tree;
  - when the package's tree in the group head (`packages/<pkg>/**` plus its `inputs:` files)
    differs from the tree at its PR's head, i.e. main changed it after the artifact was built.
  
  It also requires a green `cert-review` on the head of every PR that host-builds a package, and runs
  ladder-merge's own resolver (`resolvePackage`, read-only) for each publishable package
  at the merge commit `ladder-merge` will pick for it (`touchingCommit`). So a
  group passes only if the push will publish each PR's certified artifact, or
  skip a version that's already on npm.
- `kernel-compat`: `kernel-compat-proof.yml` (as `workflow_call`) on the
  group head, when the group touches that workflow's own `paths:`.

**At the push.** The queue fast-forwards `main` to the group head; one push
can carry several merges. `ladder-merge` resolves each publishable package at
the newest first-parent merge that touched it, whose PR (`/commits/<merge>/pulls`,
`merge_commit_sha`) gives the PR number, the head and the cert, exactly as for a
button merge (`scripts/test/merge-queue.test.mjs`). The queue's merge
message is `Merge pull request #N from …` plus the title, so `certified=`
lines go in the PR body (or come from cert-review), not in a hand-edited
merge message.

**When a group fails.** The queue drops the failing PR (and rebuilds the
entries behind it). Read the `group` job's errors:
- *touched by #a and #b*: let one land, then rebase the other onto `main`;
  its ladder-pr rebuilds against the new tree, cert-review runs again, and you enqueue it again.
- *tree … is not the tree #n's artifact was built from*: rebase #n.
- *cert-review … is failure / pending / absent*, or *ladder-merge would refuse*:
  the same refusal ladder-merge would give after merging. Fix the cert, then enqueue again.
- an `exact-pins` failure: a real crossing; fix it on the PR that comes second.

**Dry run.** `gh workflow run ladder-pr.yml --ref <branch> -f group_head=<sha>`
runs the group path on any commit shaped like a queue group (build it with
`git merge --no-ff -m 'Merge pull request #N from <owner>/<branch>' <pr head>`
per PR, from `origin/main`, and push it to a scratch branch).

**GITHUB_TOKEN.** ladder-automerge enables auto-merge with `GITHUB_TOKEN`.
Events caused by that token start no workflows, so GitHub might not fire
`merge_group` (or the push) for a PR it enqueued. It fails safe either way:
- if no `merge_group` fires, `ci` never reports on the group, and the queue drops the PR at its
  check timeout. The PR stays open, nothing is merged and nothing is published;
- if the push to `main` starts no ladder-merge, the merge lands, but nothing
  publishes. Publish the certified artifact by hand (*Manual* above:
  `gh workflow run ladder-build.yml -f package=… -f certified=<sha>`) and report it.

The rollback is to disable the ruleset; ladder-automerge then merges directly again.

### Recipe checks in `ladder-pr`

A recipe directory says how it is checked; `ladder-pr` runs it, with no
workflow file of its own:

| Recipe declares | `ladder-pr` runs |
| --- | --- |
| `inputs:` in `recipe.yaml`, a list of path globs (`crates/wasix-net/**`, `scripts/build-common.sh`) | the recipe's jobs when a PR changes a matching file, as if it touched `packages/<name>/` (`list-touched-packages.mjs`; `--publishable`, so `ladder-merge`, ignores them) |
| `packages/<name>/test/*.test.mjs` | `test (<name>)`: `node --test 'test/*.test.mjs'` in `packages/<name>`, on the built `package/` (the `host-<name>-prN` tarball unpacked over it) |
| `packages/<name>/test/package.json` | the same job: `npm ci` in `test/`, then `npm run test:e2e` when it has that script (its flags, its `pretest:e2e`), else `node --test 'e2e/*.test.mjs'` |
| `reproducible: true` in `recipe.yaml` | `rebuild (<name>)`, a second `host-run.sh` in parallel with `host-build`, and `reproducible (<name>)`: the two `package.tgz` must have the same sha256 |
| `reproducible:` with `path: package/<file>` | the same, comparing only that file of the tarball (the main `.wasm`), for a build whose tarball is not byte-stable |
| `runner: pool` in `recipe.yaml` | `host-build`, `rebuild` and `test` on `vars.CERT_RUNNER` instead of `ubuntu-latest` (see Runners) |
| `ci:` in `cert/meta.json` | each command, from the repo root, after the browser cert in `cert (<name>)`, with the tarball at `.homescoop-out/package.tgz`: recipe-specific checks, as a script in the recipe directory |

`ci`, the required check, needs every one of these jobs.

**npm parity (`npm-parity (<name>)`, every built package).** The same
`pkg@version` is never published twice, so the tarball a PR certifies must
be the one npm ends up with. `scripts/npm-parity.mjs` checks the
`host-<name>-prN` tarball against the registry (#402, #493, #497):

| The packed version | Verdict |
| --- | --- |
| sorts below npm `latest` (or is a published version other than `latest`) | **behind**: fails. The build is behind main (a stale merge base); merge main. `ladder-build` publishes with `--tag latest`, so an older version must never ship |
| is on npm, and every entry (path, type, mode, link, content) is the same | **same**: passes, nothing to publish |
| is on npm with other entries | **drift**: these bytes would never ship. Bump the packaging revision (`-N+1`) or revert. Fails (`--drift fail`, since the #497 bumps; the sweep and the bumps are on #497) |
| is not on npm and sorts above `latest`, or npm has no such package | **new**: passes, a release |

A registry that doesn't answer (after three tries) fails the job. The
comparison is `scripts/tarball-parity.mjs`, which pool-parity uses too; run
it by hand with `node scripts/npm-parity.mjs .homescoop-out/package.tgz`.

**Runners.** `host-build`, `rebuild` and `test` run on `ubuntu-latest` unless
the recipe says `runner: pool`. A recipe whose ladder jobs compile nothing, a
packaging-only `repack:` with no `smoke.c` and no tests by layout, runs on the
pool without the hint, and moves back when its next release drops `repack:`.
On the pool (`vars.CERT_RUNNER`, `cloud-run-bench`: 8 vCPU / 32 GiB, no queue,
no sudo) a recipe's bytes can differ from a hosted build: its image lacks some
of the hosted tools, and the workspace is `/home/runner/_work`, not
`/home/runner/work`; `host-build` and `rebuild` therefore build from
`/home/runner/work/<repo>/<repo>`, a link to the pool's workspace, so a build
that embeds a path under it (wasix-perl's `Config_heavy.pl`, libpng's include
directories) records the hosted path (`homescoop_load_recipe` sets
`HOMESCOOP_PKG` from `HOMESCOOP_ROOT`, since node reports the link's target). **A recipe
moves to the pool only with evidence of equal bytes:** in the PR that adds
`runner: pool`, its `host-<pkg>-prN` tarball from the pool must have the same
sha256 as a hosted twin built from the same tree (`host-run.sh` on
`ubuntu-latest`), and the PR body says so. **And it stays checked:**
[`pool-parity.yml`](../.github/workflows/pool-parity.yml) builds every pool
recipe (`classify-touched-packages.mjs --all`'s `pool`) on both runners from
the same commit of main, every Monday and on `workflow_dispatch` (its
`packages` input takes any host recipe, for a candidate or an image rollout),
and compares the two `package.tgz` sha256s, listing the entries that differ
(`scripts/tarball-parity.mjs`, npm-parity's comparison). A recipe that
differs fails the run and opens, or comments on, one `pool-parity` issue;
move it back to hosted, or fix the difference. Dispatch it whenever the
runner-bench image or the hosted image changes (#499).
`cert`, `exact-pins`, `detect`,
`reproducible`, `slicc-note` and `ci` run on the pools as before;
`recipe-sha`, which pushes with `contents: write`, stays on `ubuntu-latest`. A
fork PR runs everything on `ubuntu-latest`, since a pool job can reach the
pool's service-account token. `ladder-build`, which publishes with
`id-token: write`, stays hosted.

## Recipe shape

```yaml
name: libpng
builder: slicc         # slicc | host
version: "1.6.50"
npm: "@ai-ecoverse/wasm-libpng"
source:
  url: "https://…/libpng-{{version}}.tar.gz"
  sha256: "…"
about:
  license: libpng-2.0   # SPDX; package.json must match; LICENSE shipped in pack
dependencies:
  build:
    - zlib             # forge → ipk mamba install (slicc)
    # - "@ai-ecoverse/wasm-zlib@1.3.1-1"  # npm → ipk add -g
  host: []
  run: []
```

Recipe is SSOT for version, URL (`{{version}}` expanded by
`homescoop_load_recipe` / `recipe-env.mjs`), sha256, and SPDX license.
`host-run.sh` runs `check-package-meta.mjs` before `npm pack`. Refresh
sha after Renovate with `node scripts/refresh-recipe-sha.mjs <pkg>`.

`host-run.sh` also runs `check-slicc-cred.mjs` on the staged package: every
`.wasm` that links the slicc shims (it exports `slicc_sig_mask`) must import
`slicc_cred_js` and export `slicc_cred_euid`, so its `getuid()`/`geteuid()`
are the kernel's process credentials (`shims/slicc/slicc_libc_gaps.c`, #207).
Without them, Emscripten's libc stubs answer, and a program that acts on root
(tar's default `--same-owner`, rsync's owners, screen's socket directory)
behaves as if it were someone else.

- **`build.jsh`** — required when `builder: slicc`.
- **`build.sh`** — required when `builder: host`.
- A package may keep both scripts while migrating; CI only runs the one
  matching `builder`.

### Dependency specs

| Spec form | Slicc | Host |
| --- | --- | --- |
| `zlib` / `zlib=1.3.1` | `ipk mamba install` → `/shared/lib/conda` | skipped (forge-only) |
| `@scope/pkg` / `pkg@1.0` | `ipk add -g` → `/shared/lib/node_modules` | `npm pack` into `$PREFIX` |

`ipk mamba` landed in SLICC ([#3493](https://github.com/ai-ecoverse/slicc/pull/3493)):
emscripten-forge / conda-forge into `/shared/lib/conda`. Builds run with
`PREFIX=/shared/lib/conda` so higher rungs link forge headers and `.a` files.

## Packaging-only repack

A release that only changes `package.json` (e.g. moving an exact
`@ai-ecoverse` pin) must not rebuild binaries. Set in `recipe.yaml`:

```yaml
repack:
  from: "0.1.0-1"   # published version whose bytes are reused
  files: []         # optional extra repo files laid over the base (README.md;
                    # from package/<f>, else the build source packages/<n>/<f>;
                    # <f>=<src> takes packages/<n>/<src>: bin/cc=drivers/wasix-driver.sh)
  patches: []       # optional unified diffs over the base's files
                    # (packages/<n>/<p>.patch, paths a/package/… b/package/…)
  fields: []        # optional package.json metadata that may change too
                    # (engines, description, keywords, slicc.env)
```

`host-run.sh` then skips deps, emsdk and `build.sh`, and runs
`scripts/repack-published.mjs`: `npm pack <npm>@<from>`, then copy its tar
stream entry by entry (headers too), with the repo's `package/package.json`
(plus `files`, and the files `patches` touch) as the only new data.
`patches` are applied with `patch -p1`, no fuzz, after `files`, so a fix to
shipped text (wasm-clang's glue, homescoop#276) needs no copy of the whole
file in the repo, and a hunk that doesn't apply fails the repack. No `npm
pack` of an extracted tree:
`files` globs are case-sensitive on Linux (wasm-emscripten's `"Media"` packed
`media/` on macOS only), so a repack could drop files. The result is
checked by `scripts/diff-published.mjs`: every other entry must be
byte-identical (path, type, mode, content) to the base, but for `files` and
the patched files, and in
`package.json` only `version`, `@ai-ecoverse/*` dependency versions (exact)
and the recipe's `repack.fields` may differ. The report lands in `.homescoop-out/packaging-only-diff.txt`
and the `host-<pkg>-prN` artifact. ladder-pr's `recipe-sha` job runs
`refresh-recipe-sha.mjs --verify-repack`. It checks a repack recipe's
`source.sha256` against `source.url` but never rewrites it, because no build
fetches a repack's source (#730); the build steps skip repacks.
`scripts/recipe-sha-allowlist.txt` lists the known mismatches, each with its
issue. An entry fails once its pins match, once its issue is closed, or once
`scripts/cert-review/repack-input.mjs` finds the chain attested. Drop `repack:` when the next release really rebuilds (a changed
`homescoop.upstream` refuses to repack). A repack is also refused when a build
input changed since the version whose bytes it reuses was built
(`scripts/repack-inputs.mjs`, #735). That check follows `repack.from` down to that
version, and every file under `packages/<n>/` counts as an input except
`package/`, `cert/`, `test/`, smoke files, `*.md` and the `repack.files` and
`repack.patches` sources. `recipe.yaml`'s build fields count as inputs too. If a
change really leaves the bytes alone, say so with `repack: inputs_changed: "<why>"`.
Changes made before the check existed are pinned per file in
`scripts/repack-inputs-allowlist.txt` (#832).

Diff any tarball against a published version by hand:

```bash
node scripts/diff-published.mjs .homescoop-out/package.tgz @ai-ecoverse/wasix-uv-shim@0.1.0-1
```

## Retired recipes

`builder: retired` means the package must not be built or published.
`list-packages`, `list-touched-packages`, `host-run`, `ladder-build`, and
`reserve-names` all skip or refuse it. Examples:

- `packages/ffmpeg` — SLICC owns `ffmpeg`; `@ai-ecoverse` must not
  distribute MPEG codecs.
- `packages/wasi-hf` — custom Hub `hf` retired
  ([homescoop#110](https://github.com/ai-ecoverse/homescoop/issues/110));
  prefer official `huggingface_hub` on wasix-python. Source kept for
  provenance.
- `packages/uv-shim` — the `uv` shim over pip retired
  ([homescoop#103](https://github.com/ai-ecoverse/homescoop/issues/103)) for
  Astral's uv itself, `packages/wasi-uv`. Source kept for provenance.

Cleanup commands for historical npm versions:

```bash
node scripts/list-semver-cleanup.mjs   # includes remove-codec-distribution
```

## Commands

```bash
node scripts/read-recipe.mjs libpng --deps
node scripts/read-recipe.mjs libpng --deps-mamba
node scripts/read-recipe.mjs zlib --field builder

# Slicc path — CI (or a live cone with HOMESCOOP_ROOT mounted)
jsh scripts/ladder-run.jsh libpng

# Host path — after flipping recipe.builder to host
bash scripts/host-run.sh zlib
```

## Layout

```text
packages/<name>/
  recipe.yaml      # includes builder: slicc|host
  build.jsh        # slicc body
  build.sh         # host body (emconfigure / emmake on the runner)
  package/         # npm package root
scripts/
  read-recipe.mjs
  ladder-run.jsh   # mamba/npm deps → build.jsh → npm pack
  host-run.sh      # npm deps → build.sh → npm pack
.github/workflows/
  ladder-build.yml # branches on recipe.builder; OIDC publish
```

## Higher rungs

Only the library under build is compiled. Lower forge packages come from
`ipk mamba install` (or published `@ai-ecoverse/wasm-*` npm specs when you
prefer the homescoop tarball over forge).

## slicc libc shims (`shims/slicc/`)

Vendored C/JS shims so CI can link spawn/exec/fork/SIGPIPE without a local
slicc tree. See [`shims/slicc/README.md`](../shims/slicc/README.md).

```bash
homescoop_slicc_archive "$WORK/libslicc.a" gaps   # or spawn|make|fork
LDFLAGS="$(homescoop_em_cli_ldflags) $(homescoop_slicc_keep_exports) $WORK/libslicc.a"
# keep_exports: -Wl,-u,slicc_raise|slicc_sig_mask|slicc_sigpipe
# fork profile also needs:
#   $(homescoop_slicc_fork_js_flags)  # --js-library + ASYNCIFY
```

GNU userland recipes (coreutils, sed, grep, gawk) share
`scripts/build-gnu-cli.sh`. Patches live in `patches/`.

## CLI tools and the slicc wasm realm

Static libraries (`lib`, `include`, `.pc`) need no special link flags. **CLI
tools** (pkgconf, gmake, bash, coreutils, …) must be loadable in slicc's
plain DedicatedWorker realm ([slicc#3535](https://github.com/ai-ecoverse/slicc/issues/3535))
and in the existing node-realm `run-tool.js` path.

### Link flags

Use `homescoop_em_cli_ldflags` from `scripts/build-common.sh`:

| Flag | Why |
| --- | --- |
| `-sENVIRONMENT=web,worker,node` | Glue must run without `require`/`process` in a worker; `node` keeps the node-realm path |
| `-sEXIT_RUNTIME=1` | `main` return runs `atexit` (e.g. gnulib `close_stdout` flush) |
| `-sALLOW_MEMORY_GROWTH=1` | Tools that grow beyond the initial heap |

Optional extras via `HOMESCOOP_EM_CLI_LDFLAGS_EXTRA` (pkgconf uses
`-sSTACK_SIZE=1MB` because `pkgconf_trace` keeps a 64 KiB stack buffer).

```bash
export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=1MB"   # if needed
emconfigure ./configure … LDFLAGS="$(homescoop_em_cli_ldflags)"
```

### `package.json` `slicc` manifest

CLI packages declare command → glue/wasm pairing so the realm does not guess:

```json
"slicc": {
  "abi": "emscripten",
  "commands": {
    "pkgconf": { "glue": "bin/pkgconf", "wasm": "bin/pkgconf.wasm" },
    "pkg-config": { "glue": "bin/pkgconf", "wasm": "bin/pkgconf.wasm" },
    "convert": {
      "glue": "bin/magick",
      "wasm": "bin/magick.wasm",
      "argv0": "convert"
    }
  }
}
```

- **`abi`:** `"emscripten"` now; `"wasi"` / `"wasix"` later.
- **`argv0`:** multi-call binaries (ImageMagick utilities, GNU coreutils
  `--enable-single-binary=symlinks`).
- Stubs (gmake, cmake, imagemagick) already carry the planned `commands`
  block; update paths when the real `bin/` layout lands.

### `engines` and user ids (wasix-sysroot ≥ 2025.9.30-20)

wasix-sysroot -20 asks slicc-kernel for user and group ids (`slicc.cred_get`
and friends) and has no fallback: on a kernel without users (before 1.44.0),
`getuid()` returns -1 and set\*id fails with ENOSYS. The same holds for
Emscripten packages linked with `shims/slicc` since the H1 release
(homescoop#207). A package built on them must declare it:

```json
"engines": { "slicc-kernel": ">=1.44.0" }
```

`scripts/check-package-meta.mjs` (run by `host-run.sh` on every build) fails
a package whose `.wasm`/`.so` imports `slicc.cred_*` without that floor.

It also fails a non-retired package whose `package.json` has no
`"repository": { "type": "git", "url": "git+https://github.com/ai-ecoverse/homescoop.git", "directory": "packages/<name>/package" }`.
npm provenance (ladder-build's OIDC publish) rejects a package without it
(E422, `repository.url is ""`). `check-package-meta.mjs --drift --all`
checks it repo-wide.
