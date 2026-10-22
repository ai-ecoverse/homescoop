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

## CI: one workflow (`ladder-build.yml`)

Everything CI does is in [`.github/workflows/ladder-build.yml`](../.github/workflows/ladder-build.yml).
npm trusted publishing is bound to that file name (`fledgling.workflow`,
and the provenance check's `PUBLISH_WORKFLOWS` in
`scripts/cert-review/repack-input.mjs`), so there is one file and nothing to
re-trust. It runs [slicc-shared-web's pipeline](https://github.com/ai-ecoverse/slicc-shared-web#pipeline)
as a reusable workflow for lint, tests and the dual review.

```text
pull_request
  detect ── classify-touched-packages.mjs: only the recipes the change touches
  ├─ recipe-sha, host-build, rebuild, reproducible, npm-parity, test, cert   (per touched recipe)
  ├─ shims, emsdk-cache / crates-host, crates-kernel, crates-consumer         (when touched)
  └─ pipeline (slicc-shared-web)  after all of them:
       lint (npm run lint, actionlint) · integration (scripts/test/*.test.mjs, 4 shards)
       reviewer × {claude, codex}: the change, the host-<pkg>-prN tarballs and
       cert-<pkg>-prN reports (`artifacts`), four browsers with the packages loaded
       (scripts/review-browser.mjs) · review: both approved
  ci ── every job above passed or was skipped, and the pipeline passed   ← the required check
merge_group
  detect · group (merge-group-check.mjs) · pipeline (lint, tests; review is green) · ci
push to main
  detect (list-touched-packages.mjs --publishable) → publish × package (OIDC) · close-listed-issues
workflow_dispatch (main): publish named packages · issues / hourly: issue-labels
```

**The one required check is `ci`.** It needs every job of the run, the
pipeline included, so a pull request merges only when its touched recipes
built, reproduced, matched npm, passed their tests and cert specs, and both
reviewers (Claude and Codex, on Bedrock) approved. A pull request that
touches no recipe still gets lint, tests and the review. Every pull request is
reviewed, Renovate's too (`review-renovate: '*'`). The pipeline's own checks
(`pipeline / review`, `review / claude`, `review / codex`) are for reading.

**Selective builds.** `detect` runs `scripts/classify-touched-packages.mjs`
on the pull request's range, so a PR builds only the recipes whose
`packages/<name>/`, `inputs:` or toolchain inputs it changes (*Recipe checks*
below). The build jobs are matrices over that list and are skipped when it is
empty.

**The reviewers run the new packages.** The pipeline's `artifacts` input
(`@(host|cert)-*-pr<N>`) hands each reviewer this run's tarballs and cert
reports in `$RUNNER_TEMP/review/artifacts/`. For each of the pipeline's four
review browsers, `review-browser` (the head's `scripts/review-browser.mjs`, run in each side's tree, so a base from before the hook still gets its browsers) boots a
slicc-kernel page (the cert harness's `scripts/browser-cert/page`) and
installs the packages: on the **head** side this PR's tarballs, on the
**base** side the same names from npm (the recipe's `npm-tag:`, else
`latest`). The **extension** browsers boot the cert kernel (root
`package.json`'s `@ai-ecoverse/slicc-kernel`), the **cli** browsers
slicc-kernel's npm `latest`; wasm-bash, wasm-coreutils and each recipe's
`cert/meta.json` `needs` come from npm. Each browser also answers the cert
spec context over HTTP (`POST <ctx>ctx/run` and the rest of
`scripts/browser-cert/context.mjs`), described in
`$RUNNER_TEMP/review/homescoop/<side>-<link>.json`. A browser the hook can't
set up is reported there, and the review goes on.

**Publish gate (`scripts/ladder-merge-resolve.mjs`).** On a push to `main`,
`detect` lists the publishable packages the push touched (`--publishable`:
`recipe.yaml` or `package/`; a `build.sh`-only change does not republish).
For each, the `publish` job maps the package to the newest first-parent
commit of the pushed range that touched it, and to the PR merged as that
commit. When the merged `package.json` version is already on npm it skips.
Otherwise it needs that PR's `host-<pkg>-prN` artifact from a
**`ladder-build.yml` `pull_request` run at the PR's merged head that
concluded `success`**, which means every job of that run passed, both
reviews included. The artifact's zip must match its digest, its
`package.tgz` must match its `package.tgz.sha256`, and the tarball must be
the merged package.json's name and version. Candidates are tried newest first;
a candidate whose run is at another head, failed, or whose run or jobs request
fails is rejected with that reason, and the next one is tried (GET requests
are retried once after a 5xx). Anything else fails the package red and
publishes nothing.

**A publish-path change publishes nothing (#1712).** A PR's `pull_request`
run executes that PR's own copy of the workflow and the gate scripts, so its
green run says nothing about a gate it replaces. When the PR's `base...head`
range touches the publish path (`PUBLISH_PATH` in
`scripts/ladder-merge-resolve.mjs`: `ladder-build.yml`, the resolve and
merge-group scripts, everything the `publish` and `group` jobs run and load,
and `scripts/review-browser.mjs`) and the PR would release a package, the
resolve refuses it, and so does the merge-group check, which resolves each
member the same way. Land the publish-path change in a PR that releases no
package (it merges normally and publishes nothing), then release the package
from a later PR. `scripts/test/ladder-merge-resolve.test.mjs` checks that the
list covers every script those jobs run.

There is no other path: no certification record from another workflow, no
dispatch to another workflow. The bytes that ship are the bytes the reviewers
had in their browsers.

**The publish** runs on `ubuntu-latest` (npm takes OIDC tokens and provenance
only from GitHub-hosted runners), one per npm name at a time (#1151). It
checks `sync-package-version.mjs <pkg> --check`, resolves, and runs
`scripts/oidc-publish.sh`, which strips any `_authToken`, then
`scripts/npm-publish.mjs` through `gate.mjs publish` with the artifact's
sha256 as `--certified`. npm-publish runs `assert-certified-publish.mjs`
first, which refuses a version below its dist-tag and a version that npm
already has with other contents (#971), then `npm publish --tag <tag>`
(`latest`, or the recipe's `npm-tag:`). When npm answers "cannot publish over
the previously published versions" (a re-run, or a lost race), the same
contents on npm is `publish: PASS … (already on npm, same contents)`; other
contents fail. A missing verdict line fails the step.

**Dispatch:** `gh workflow run ladder-build.yml -f packages=zlib,jq` (on
`main` only) runs the same resolve and publish for those recipes, each from
the PR that last changed it on main: for a push that published nothing, or a
publish that failed for an outside reason. `npm_loglevel` (`http`, `timing`
or `verbose`) traces the npm publish (`scripts/test/ladder-build-npm-loglevel.test.mjs`).
To resolve without publishing, run the resolver locally:
`GH_TOKEN=… node scripts/ladder-merge-resolve.mjs --package <pkg> --sha <main sha> --dry-run [--pr <n>] [--head <sha>] [--assume-unpublished]`.

**Merging.** PRs merge through the merge queue only: open the PR, then
enable GitHub's native auto-merge right away with
`gh pr merge <n> --auto --merge --match-head-commit <sha>`. GitHub waits for
`ci`, then enqueues. Renovate does the same for the PRs its rules automerge
(`platformAutomerge`). Enable auto-merge with your own token (or Renovate's
app token): an enqueue by `GITHUB_TOKEN` starts no `merge_group` run.
`close-listed-issues` closes the issues a merged PR lists after a closing
keyword, since a queue merge doesn't.

`scripts/list-touched-packages.mjs` maps changed paths → recipe names.
`host-build` uploads `package.tgz` + sha256 as `host-<pkg>-prN`, runs
`packages/<name>/smoke.c` via `scripts/host-smoke.sh` when present, then
`cert` runs the browser cert for emscripten CLIs: Chromium +
`@ai-ecoverse/slicc-kernel` via the cert harness
(`slicc-shared-web-cert`, an alias of `@ai-ecoverse/slicc-shared-web` pinned
apart from the pipeline's) over CDP (`scripts/browser-cert/run.mjs`), and
uploads its report as `cert-<pkg>-prN`. Optional
`packages/<name>/browser-cert.json` sets `argv` / expected `stdout`; default
is `<command> --version`. Libs without `slicc.commands` skip browser-cert
(host-smoke is the gate). `npm-parity` also runs the build-input root rule
(`scripts/cert-review/repack-input.mjs`: a build fetches its pinned source, a
repack traces to an attested or reproduced build).
`scripts/sync-package-version.mjs` sets `package.json` version from the
recipe when Renovate bumps upstream (leaves existing `X-N` packaging revs).
The `recipe-sha` job checks that the PR already carries that sync and never
pushes: a stale branch fails with its
`recipe-sha: FAIL <pkg>: needs refresh: <command>` line (docs/renovate.md).

### Merge queue

`main` merges through a merge queue (merge commits only, ALLGREEN, at most
3 entries); the queue requires `ci`.

**What a group runs.** The queue builds `gh-readonly-queue/main/pr-N-…`, one
merge commit per queued PR on top of `main` (each PR head is the second
parent), and fires `merge_group`. The build jobs run on `pull_request` only,
so a group builds **nothing**. It runs:

- the pipeline's lint and integration tests on the group head (its review is
  green in the queue: the pull request was reviewed already). These are the
  checks that caught both crossings of 10-16 (#814 with #816, #854 with
  reproducible-optin);
- `detect`, with the cert-kernel check;
- `group` (`scripts/merge-group-check.mjs`): from `main` to the group head,
  every first-parent commit must be a two-parent `Merge pull request #N`
  commit whose PR is open with that second parent as its head. For each package
  a member touches (recipe `inputs:` included), it fails the group:
  - when two queued PRs touch the package, since no artifact was built from the combined tree;
  - when the package's tree in the group head (`packages/<pkg>/**` plus its `inputs:` files)
    differs from the tree at its PR's head, i.e. main changed it after the artifact was built.

  It also runs the publish resolver (`resolvePackage`, read-only) for each
  publishable package at the merge commit the push will resolve it at
  (`touchingCommit`), so a group passes only if the push will publish each
  PR's reviewed artifact, or skip a version that's already on npm.

**At the push.** The queue fast-forwards `main` to the group head; one push
can carry several merges. `publish` resolves each publishable package at the
newest first-parent merge that touched it, whose PR (`/commits/<merge>/pulls`,
`merge_commit_sha`) gives the PR number and the head, exactly as for a button
merge (`scripts/test/merge-queue.test.mjs`).

**When a group fails.** The queue drops the failing PR (and rebuilds the
entries behind it). Read the `group` job's errors:
- *touched by #a and #b*: let one land, then rebase the other onto `main`;
  its pull request run rebuilds against the new tree and is reviewed again, and you enqueue it again.
- *tree … is not the tree #n's artifact was built from*: rebase #n.
- *the push would refuse*: the same refusal the publish would give after merging.
- a lint or test failure: a real crossing; fix it on the PR that comes second.

**If the push publishes nothing** (a `publish` leg failed for an outside
reason), dispatch `ladder-build.yml` with `packages=<recipe>` on `main` and
report it.

### Recipe checks

A recipe directory says how it is checked; `ladder-build` runs it on its pull request, with no
workflow file of its own:

| Recipe declares | the pull request runs |
| --- | --- |
| `inputs:` in `recipe.yaml`, a list of path globs (`crates/wasix-net/**`, `scripts/build-common.sh`) | the recipe's jobs when a PR changes a matching file, as if it touched `packages/<name>/` (`list-touched-packages.mjs`; `--publishable`, so the publish, ignores them) |
| a build (`builder: host`, no `repack:`) whose own scripts use a shared toolchain: `packages/<name>/*.sh` and the `scripts/*.sh` they run or source (not `build-common.sh` or `host-run.sh`), comments ignored | the same, without declaring it: Emscripten (`emcc`, `emconfigure`, `emmake`, `emcmake`, `emar`, `homescoop_slicc_*`, `homescoop_em_*`) adds `scripts/install-emsdk.sh`, `scripts/emsdk-patches/**` and `shims/slicc/*.{c,h,js}`; `homescoop_wasm_opt` (emsdk's binaryen) adds `scripts/install-emsdk.sh`; `install-wasixcc.sh`, `install-rust.sh`, `install-go.sh` or `install-wasi-sdk.sh` adds that script; and each `scripts/*.sh` it runs is an input too (`toolchainInputs` in `list-touched-packages.mjs`, also in the merge-queue tree check, #857). cmake and emscripten-cache, which take their objects from the slicc-emscripten checkout outside the repo, get none (`OUTSIDE_BUILDS`): CI can't build them until #859. A shim, emsdk-patch or sysroot change therefore rebuilds every consumer, and npm-parity makes the PR bump the ones whose bytes change |
| `packages/<name>/test/*.test.mjs` | `test (<name>)`: `node --test 'test/*.test.mjs'` in `packages/<name>`, on the built `package/` (the `host-<name>-prN` tarball unpacked over it) |
| `packages/<name>/test/package.json` | the same job: `npm ci` in `test/`, then `npm run test:e2e` when it has that script (its flags, its `pretest:e2e`), else `node --test 'e2e/*.test.mjs'` |
| a build (`builder: host`, no `repack:`), or `reproducible: true` in `recipe.yaml` | `rebuild (<name>)`, a second `host-run.sh` in parallel with `host-build`, and `reproducible (<name>)`: the two `package.tgz` must have the same sha256. This is the default since #808. `reproducible: false` turns it off (the test wants an issue for that), and the recipes in `scripts/reproducible-pending.json` are off until a build shows them reproducible |
| `reproducible:` with `path: package/<file>` | the same, comparing only that file of the tarball (the main `.wasm`), for a build whose tarball is not byte-stable |
| `reproducible:` with `same_path: <issue>` | `rebuild` builds in `host-build`'s directory, WORK and user name instead of its own (see below), for a recipe known to embed its build path; the issue tracks the fix. It combines with `path:` |
| `runner: pool` in `recipe.yaml` | `host-build`, `rebuild` and `test` on `vars.CERT_RUNNER` instead of `ubuntu-latest` (see Runners) |
| `ci:` in `cert/meta.json` | each command, from the repo root, after the browser cert in `cert (<name>)`, with the tarball at `.homescoop-out/package.tgz`: recipe-specific checks, as a script in the recipe directory |

`ci`, the required check, needs every one of these jobs.

**npm parity (`npm-parity (<name>)`, every built package).** The same
`pkg@version` is never published twice, so the tarball a PR certifies must
be the one npm ends up with. `scripts/npm-parity.mjs` checks the
`host-<name>-prN` tarball against the registry (#402, #493, #497):

| The packed version | Verdict |
| --- | --- |
| sorts below the version under its tag on npm (`latest`, or the recipe's `npm-tag`) | **behind**: fails. The build is behind main (a stale merge base); merge main. `ladder-build` publishes with `--tag <tag>`, so an older version must never ship |
| is on npm, and every entry (path, type, mode, link, content) is the same | **same**: passes, nothing to publish |
| is on npm with other entries | **drift**: these bytes would never ship. Bump the packaging revision (`-N+1`) or revert. Fails (`--drift fail`, since the #497 bumps; the sweep and the bumps are on #497) |
| is not on npm and sorts above the version under its tag, or npm has no such tag or package | **new**: passes, a release |
| has an `npm-tag`, and npm has no `latest` for the name | **no-latest**: fails. The first publish of a name becomes `latest` whatever its tag |

A registry that doesn't answer (after three tries) fails the job. The
comparison is `scripts/tarball-parity.mjs`; run
it by hand with `node scripts/npm-parity.mjs .homescoop-out/package.tgz`.

**Runners.** `host-build`, `rebuild` and `test` run on `ubuntu-latest` unless
the recipe says `runner: pool`. A recipe whose ladder jobs compile nothing, a
packaging-only `repack:` with no `smoke.c` and no tests by layout, runs on the
pool without the hint, and moves back when its next release drops `repack:`.
On the pool (`vars.CERT_RUNNER`, `cloud-run-job`: 8 vCPU allocated, 32 GiB
of memory shared with its memory-backed filesystem, no sudo, egress only
from a link-local address) a recipe's bytes can differ from a hosted build: its image lacks some
of the hosted tools, and the workspace is `/home/runner/_work`, not
`/home/runner/work`; `host-build` therefore builds from
`/home/runner/work/<repo>/<repo>`, a link to the pool's workspace, so a build
that embeds a path under it (wasix-perl's `Config_heavy.pl`, libpng's include
directories) records the hosted path (`homescoop_load_recipe` sets
`HOMESCOOP_PKG` from `HOMESCOOP_ROOT`, since node reports the link's target).
`rebuild` builds elsewhere on purpose, so `reproducible` proves the bytes don't
depend on the build path (#668): a real copy of the checkout at
`/home/runner/work/<repo>-rebuild/<repo>`, `HOMESCOOP_WORK=$TMPDIR/homescoop-rebuild-work`
and `USER`/`LOGNAME` `homescoop-rebuild` (`scripts/ladder-build-root.sh`), unless the
recipe sets `reproducible.same_path`. **A recipe
moves to the pool only with evidence of equal bytes:** in the PR that adds
`runner: pool`, its `host-<pkg>-prN` tarball from the pool must have the same
sha256 as a hosted twin built from the same tree (`host-run.sh` on
`ubuntu-latest`), and the PR body says so. Since #1697 no workflow rebuilds every pool
recipe on both runners; when the runner-job image or the hosted image changes (#499), compare
a pool build with a hosted twin by hand with `scripts/tarball-parity.mjs`
(npm-parity's comparison), and move a recipe that differs back to hosted.
**`scripts/pool-hold.json` is a temporary hold:** a JSON array of
`runner: pool` recipes that run `host-build`, `rebuild` and `test` on
`ubuntu-latest` anyway, for a pool image that has lost a tool they need
(October 2026: cmake and `/usr/bin/clang`, so freetype, openjpeg and
tls-engine), without touching their recipes (which would rebuild, certify
and publish them). `classify-touched-packages.mjs` leaves them out of `pool`,
and
a name that is not a `runner: pool` recipe, or a file that is not an array
of names, fails the classifier. Empty it (`[]`) once the pool image has
cmake and clang again.
Some recipes stay hosted for reasons outside their bytes (#390 C2):
`qpdf`, whose
`qpdf.wasm` comes out differently on the pool in some runs (#804); and
`wasix-python`, whose `build.sh` runs `sudo apt-get`.
`cert`, `detect`, `reproducible` and the pipeline run on the pools as before;
`recipe-sha` (read-only, it never pushes) runs on `CERT_LIGHT_RUNNER` for a same-repo head,
whatever the recipe's `runner:`, so its source fetch may need the mirrors above. A
fork PR runs everything on `ubuntu-latest`, since a pool job can reach the
pool's service-account token. `publish`, which publishes with
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

### A source sha256 never changes silently (#1267)

`refresh-recipe-sha.mjs` (the `recipe-sha` job and `npm run refresh-sha`)
rewrites a `source.sha256` or `sources.<key>.sha256` only when that source's
resolved URL differs from the one at the merge-base with the PR's base
(`--base`, default `origin/main`; `RECIPE_SHA_BASE` overrides it). A package that
is new at the base counts as a changed URL. Even then, only a pin carried over
from the base (Renovate bumps only `version:`) or an empty one is refreshed: a pin
the branch already set fails when its bytes move. So a new package's recipe
carries either the right sha256 or an empty one (`sha256: ""`), which gets filled in. When the URL is unchanged and the
bytes differ from the pin, it prints
`recipe-sha: FAIL <pkg>: <url> changed bytes for an unchanged URL (pinned <old>, got <new>)`,
exits non-zero and writes nothing, so the job pushes nothing. A person decides.
If the base can't be resolved (a shallow checkout), a mismatch fails the same way.

GitHub's generated archives (`github.com/<o>/<r>/archive/<40-hex>.tar.gz`,
`codeload.github.com`) aren't byte-stable: an archive's `export-subst` files
expand `%(describe)`, which moves when upstream adds a tag, and the compression
may change. Such a source pins its content with `tree:`, the git tree sha of the
commit (`gh api repos/<o>/<r>/git/commits/<sha> --jq .tree.sha`):

```yaml
source:
  url: "https://github.com/llvm/llvm-project/archive/b158b0ae….tar.gz"
  sha256: "…"
  commit: "b158b0ae…"
  tree: "3690321e…"
```

`scripts/source-tree.mjs` checks an archive against it: it fetches the commit
(depth 1) from the repo (taken from the URL, or `git:` and `commit:` for other
hosts), checks the commit's tree is the pin, and compares the archive's files
with that tree through git itself (`core.autocrlf=false`, the tree's
`.gitattributes` undo eol conversions, committed files that `.gitignore` matches
count). The only differences allowed are `export-ignore` paths and files marked
`export-subst` (listed in the log) that match their blob outside the
`$Format:…$` placeholders. The extractor is chosen by the archive's magic bytes,
so a codeload zip URL without an extension works. ladder-build passes the base as
`RECIPE_SHA_BASE`, not as an argument, because the job runs the branch's own
script and older ones would take an argument as a package name. It prints `source-tree: PASS|FAIL …`.

A changed sha256 for an unchanged URL whose archive matches `tree:` is a re-roll.
GitHub regenerates archives, and it can serve another gzip of the same commit on
most runs (#1491's llvm-project archive).
- **Where it applies:** with `refresh-recipe-sha.mjs <pkg> --ci-reroll`, a re-roll of a pin carried over unchanged from the base passes only when the archive matches `tree:` under the narrow rule:
  - every path is byte-for-byte the committed tree;
  - except files listed in the recipe's `tree_subst:` (e.g. `clang/bindings/python/.git_archival.txt` for llvm-project, whose `describe-name` moves with each new tag), which the tree's own `.gitattributes` marks `export-subst`. Those may differ only at their `$Format:…$` placeholders, and each substituted value is one line of `[A-Za-z0-9._+~:/ -]`, at most 200 characters;
  - the paths missing from the archive are exactly the tree's `export-ignore` set;
  - no extra paths.

  Each accepted re-roll prints:
  ```text
  recipe-sha: REROLL <pkg> <old>→<new> sha256 tree=<tree> subst=<path>[<values>]
  ```
  The step runs through `gate.mjs recipe-sha` and fails if a re-roll has no such line. The jobs that run it:
  - `host-build` and `rebuild` write the new pin into their own checkout only, which has no push credentials and no id-token;
  - the `recipe-sha` job adds `--keep-pin`, so it passes with the REROLL line and writes nothing.

  A changed pin or URL, a recipe without `tree:`, and a difference no `tree_subst:` covers all stay strict and fail. The source sha256 doesn't reach the package (llvm-emscripten's published tarball has the commit, not the archive sha), so a re-roll can't change the published bytes.
- **The publish path downloads nothing.** It publishes the reviewed PR artifact; nothing is rebuilt on `main`.
- **Local builds:** run `node scripts/refresh-recipe-sha.mjs <pkg> --ci-reroll` before `host-run.sh`. The pin it writes must never be committed.
- **Refreshing the committed pin** is explicit: `node scripts/refresh-recipe-sha.mjs <pkg> --reroll` logs the tree check (the older rule: export-subst placeholders of any marked file, and export-ignore paths, allowed). Commit that log line's verdict in the PR body. homescoop_fetch stays strict. An archive that doesn't match the
tree fails, with or without `--reroll`. the `recipe-sha` job also passes
`--verify-tree`, so a pinned tree is checked on every PR that touches the package,
even when the sha256 matches.

### Source mirrors

An upstream that blocks a runner pool (greenwoodsoftware.com answers
`cloud-run-job` with 403) or times out (ftp.gnu.org) mustn't block CI. A
source may list byte-identical copies, URL templates expanded like `url`:

```yaml
source:
  url: "https://www.greenwoodsoftware.com/less/less-{{version}}.tar.gz"
  sha256: "2819f555…44b8"
  mirrors:
    - "https://deb.debian.org/debian/pool/main/l/less/less_{{version}}.orig.tar.gz"
    - "https://distfiles.macports.org/less/less-{{version}}.tar.gz"
```

`sources.<key>.mirrors` works the same. Everything that downloads a source
(`refresh-recipe-sha.mjs`, so the `recipe-sha` job and the build jobs' refresh
step, and `homescoop_fetch` in every `build.sh`, which finds a pin's mirrors in
`HOMESCOOP_MIRRORS_<sha256>` from `recipe-env.mjs`) tries `url` first, then
each mirror in order, only when the url's download fails, and keeps a mirror's
bytes only when they match the pinned sha256. It prints
`source: <pkg> from mirror <url> (sha256 match)`. A url that answers with
other bytes still fails as above; the mirrors don't hide it.

A mirror never sets or refreshes a pin. `refresh-recipe-sha.mjs` tries one
only when the source's url and its pin are both the base's, so the pin came
from the url on an earlier run; a new or changed url, an empty pin, or one the
branch set, takes its pin from the url alone, and if the url fails, so does
the recipe. A shallow checkout with no merge-base (the build jobs) fetches the base branch's tip (depth 1) for this comparison.
`homescoop_fetch` compares only with the pin, since the `recipe-sha` job has
already checked it. Mirrors are no build input (`repack-inputs.mjs`'s
`buildView` drops them with a pinned url), so adding one needs no `-N` bump.
`scripts/test/source-mirrors.test.mjs` is the behaviour test.

`scripts/test/source-tree-pin.test.mjs` lists the GitHub commit-archive sources
without `tree:`. `scripts/source-tree-allowlist.txt` holds today's, each tied to
#1267; an entry fails once its source pins a tree.

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
and the `host-<pkg>-prN` artifact. The `recipe-sha` job runs
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

## Publishing a wave under a dist-tag

A wave (the Python 3.15 wave, #1138) publishes new versions of a name to npm
without moving `latest`: the wave's packages pin each other by registry URL
plus sha, so they must be on npm, but the old line stays `latest` until the
whole set is certified. Publishing stays main-only; there is no long-lived
branch. During the wave, a second recipe dir sits beside the base one under
the same npm name, e.g. `packages/wasix-python3.15` with
`npm: "@ai-ecoverse/wasix-python"` and:

```yaml
npm-tag: "python3.15"
```

**The field.** `npm-tag:` is optional; without it a recipe publishes under
`latest`. It must match `^python\d+\.\d+$` (`scripts/npm-tag.mjs`, the one
place the rule lives); `latest`, `certified` and `next` are refused, and so
is anything else. `node scripts/npm-tag.mjs <dir>` prints a recipe's tag.
`ladder-build` publishes with `npm publish --tag <tag>`, so a tagged recipe
never moves `latest`. A name with no `latest` on npm refuses a tagged
publish, since npm makes a name's first version `latest` whatever its tag.

**One recipe per tag.** `scripts/test/npm-tag.test.mjs` fails when two
recipes of one name publish under the same tag (the second one needs a
non-latest `npm-tag`), and when a name with two recipes isn't in
`scripts/npm-tag-allowlist.txt` (`<@scope/name> #<wave issue> <reason>`). An
entry whose name is back to one recipe is stale and fails too; the fold PR
drops it.

**The guards, per tag.** Each guard judges a version against the version
under its own tag, never against other tags:

- `npm-parity` (`--tag` from the PR's recipe) calls a version **behind** when it sorts below the
  version under its tag. On a tag's first publish there is none, so it's new.
  An untagged recipe compares with `latest` only.
- `assert-certified-publish` (`publish`, `--tag`) refuses the same way at
  publish time.
- A version that is already on npm with other bytes is **drift**, whatever
  its tag.
- `list-semver-cleanup.mjs` never lists a version that is under any
  dist-tag, and judges a version in a tagged line (the same `major.minor` as
  a non-latest tag's version) against that tag instead of `latest`.
- the review browsers' base side for a tagged recipe is the version under its
  tag (`npm pack <name>@<tag>`); on the tag's first publish there is none,
  as for a new package.

**Lookups.** Everything that goes from a package to its recipe does it by
dir (`host-<dir>-prN` artifacts, `ladder-build -f packages=<dir>`,
`repository.directory` in the published package.json) or by `name@version`
(`compat.mjs`'s bios pins via `pickRecipe`), so both dirs
of one name resolve. The README table has one row per dir and shows the tag.

**The flip.** When the whole wave is certified, the coordinator moves
`latest` to each package's certified tagged version with `tag-certified.sh`
(`npm dist-tag add <name>@<version> latest`). The fold PR then `git mv`s the
tagged dir over the base dir, drops `npm-tag`, and drops the allowlist entry.
Its next version publishes under `latest` again. The old tag may stay on npm
until Lars's npm session can delete it (`npm dist-tag rm <name> <tag>`);
nothing reads it after the fold.

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
  ladder-build.yml # the one workflow: selective PR builds, the pipeline, OIDC publish
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
