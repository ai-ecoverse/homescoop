# Renovate — upstream recipe bumps

Renovate (`renovate.json`) watches `packages/*/recipe.yaml` via a regex
manager. Each recipe pins its upstream with a comment:

```yaml
# renovate: datasource=github-releases depName=madler/zlib extractVersion=^v(?<version>.*)$
version: "1.3.1"
```

When upstream cuts a release, Renovate opens a PR labeled `homescoop-recipe`
(no automerge). CI:

1. **The PR's `ladder-build` run** host-builds each touched `packages/<name>`
   (no publish), certifies it and has Claude and Codex review it; `ci`, the
   required check, needs both approvals.
2. **The push to `main`** publishes each touched package from that run's
   artifact (OIDC, the same workflow file). `package.json` must already
   match the new recipe version (the `recipe-sha` job below checks that);
   the publish fails on a mismatch instead of syncing.

The `recipe-sha` job runs `refresh-recipe-sha.mjs` and
`sync-package-version.mjs --write` (which also rewrites the old upstream
version in `description`, the recipe `summary` and `package/README.md`)
and `readme-table.mjs --write` in its checkout, and **only checks**: CI
never pushes to a pull request (a `github-actions[bot]` push leaves the new
head's runs waiting for "Approve and run"). A stale branch fails with one
machine-readable line per package,
`recipe-sha: FAIL <pkg>: needs refresh: node scripts/refresh-recipe-sha.mjs <pkg> && node scripts/sync-package-version.mjs <pkg> --write && node scripts/readme-table.mjs --write`,
plus `recipe-sha: FAIL README.md: needs refresh: node scripts/readme-table.mjs --write`
when only the root table is stale. Anyone can run the printed command and
push. A refreshed PR then carries the new version everywhere;
`check-package-meta.mjs` fails the build when any text still names the old one
(docs/versioning.md, "Upstream versions in text").

### The refresh

For Renovate PRs no person or agent has to act on those lines:
[`scripts/renovate-refresh.mjs`](../scripts/renovate-refresh.mjs) does it, run
by `scripts/renovate-refresh-host.sh` (its own clone, main's scripts) from a bb
script automation on Lars's host every 15 minutes. It pushes with that host's
git credentials, so the PR's runs start normally; the Mend-hosted Renovate app
runs no `postUpgradeTasks`, and a `GITHUB_TOKEN` push starts none. Before it,
the refresh waited for the coordinator agent, and bumps stalled for days when
it was down (#2083, #2085 and #2087 in November 2026).

It picks an open PR by Renovate (not a draft, not from a fork, on a
`renovate/` branch) that changes only `packages/*/recipe.yaml`, whose commits
are all Renovate's and whose `recipe-sha` check failed on that head. For each,
in a temporary worktree, it rebases onto main (so the branch's own scripts,
which the `recipe-sha` job runs, are main's), runs the printed command for each
touched recipe with `RECIPE_SHA_BASE=origin/main`, and commits only
`packages/<pkg>/recipe.yaml`, `package/package.json`, `package/README.md` and
`README.md` as `renovate-refresh@homescoop.invalid` (in `gitIgnoredAuthors`, so
Renovate keeps rebasing the branch; a Renovate rebase drops the commit and the
next run writes it again). It pushes with `--force-with-lease` against the head
it read, so a push that races Renovate or a queued PR is refused and retried
later.

Anything that isn't mechanical stays with a person or the coordinator: a draft
(a held bump such as #1932), a head with any commit not by Renovate (hand work
or an earlier refresh), a rebase conflict, a refresh that fails (patches that no
longer apply show up later, in host-build; here: a tag that moved, bytes that
changed under an unchanged URL, a missing download), or a change outside those
files. A failed refresh gets one PR comment per head
(`<!-- homescoop:renovate-refresh -->`, the reason and the log's tail) and
nothing is pushed. Run it by hand with
`node scripts/renovate-refresh.mjs [--pr <n>] [--dry-run]`;
`scripts/test/renovate-refresh.test.mjs` covers the choice and a refresh
against a local origin.

Manual publish of a merged recipe whose push published nothing: `gh workflow run ladder-build.yml -f packages=zlib`.

Renovate only rewrites `version:` lines. Recipe `source.url` (and
`sources.*.url`) must use `{{version}}` / `{{major}}` / `{{minor}}`
placeholders so the tarball URL tracks the bump (libxml2's GNOME path is
`{{major}}.{{minor}}/libxml2-{{version}}.tar.xz`; libpng stays on the
`libpng16/{{version}}` series). Do not hardcode `SRC_DIR` / `TARBALL`
versions in `build.sh` — `homescoop_load_recipe` sets them from the
recipe.

**Commit-pinned sources follow a tag.** A source pinned to a GitHub commit
archive (`archive/<40-hex>.tar.gz` with `commit:` and `tree:`, such as
wasi-yq and wasi-html-to-markdown) can't put `{{version}}` in its URL. It
names the upstream tag instead, as a template:

```yaml
source:
  url: "https://github.com/mikefarah/yq/archive/f2944b82….tar.gz"
  sha256: "…"
  tag: "v{{version}}"
  commit: "f2944b82…"
  tree: "dfe36c54…"
```

`refresh-recipe-sha.mjs` fetches that tag (`git:`, or the repo in the URL) and,
when it names another commit than the one pinned, re-pins first: the commit in
`url:` and `commit:`, `tree:` (the commit's tree) and the short commit in
`package/README.md`, printing
`recipe-sha: REPIN <pkg> <tag> <old>→<new>`; the sha256 refresh then sees a
changed URL and checks the archive against the new tree. So the printed
refresh command is all a Renovate bump of such a recipe needs (before, each
one needed the commit re-pinned by hand: #2061, #2088). It re-pins only a
commit carried over from the base, and only for a new tag: a tag the base
pinned to another commit has moved upstream, which fails and writes nothing. `--check` re-pins nothing and fails on a stale pin. `about.notes` is
not rewritten; update its version and commit by hand.

The PR run downloads the expanded URL and checks the PR branch's `sha256`
(see above), and also refreshes sha256 in the host-build checkout. A bump whose patches no
longer apply fails at `homescoop_apply_patches` with a patch error, not
a checksum error. It rewrites a sha256 only when the source URL changed
against the base; new bytes for an unchanged URL fail instead (#1267, see
[ladder-builds.md](ladder-builds.md#a-source-sha256-never-changes-silently-1267)).

Manual refresh:

```bash
node scripts/refresh-recipe-sha.mjs <package>
# or: npm run refresh-sha -- <package>
# --check: fail if the committed sha256 does not match the download
```

Recipe bumps automerge **only** for packages in
[`scripts/ci-certified.json`](../scripts/ci-certified.json) (full
`packages/<name>/cert/*.mjs` checklist + recorded negative proof; sync into
`renovate.json` via `node scripts/sync-ci-certified-renovate.mjs`). The list
only scopes automerge; the merge queue still requires `ci`, which needs both
reviewers' approval. Semver
**majors** and packages not on that list stay manual (`homescoop-major` /
`homescoop-recipe`). See [ci-cert.md](ci-cert.md).

Publish uses the exact PR artifact, from a green (built, certified and
reviewed) run at the merged head
([ladder-builds.md](ladder-builds.md#ci-one-workflow-ladder-buildyml)).

`build.sh` loads version/URL/sha via `homescoop_load_recipe`. Secondary
tarballs (ncurses, mbedtls, unzip) live under `sources:` in the same recipe.

Patches live beside the recipe as `packages/<name>/*.patch` (applied by
`homescoop_apply_patches`).

## Coverage

| package | upstream | notes |
| --- | --- | --- |
| aws-cli | `aws/aws-cli` | github-tags, `2.x` only (renovate.json: the repo tags v1 too); the recipe pins AWS's source distribution, and build.sh checks the recipe's wheels against its `system-sandbox-lock.txt`, so a bump that moves a dependency fails until the wheel `sources:` follow |
| azure-cli | PyPI `azure-cli` | `pypi`; the recipe pins upstream's `requirements.py3.Linux.txt` and `trim_sdk.py` at the release tag (the sha256 refresh fills both). A bump also needs `python3 packages/azure-cli/src/lock.py` (uv and the network) to rewrite `wheels.lock`: build.sh refuses a lock made for another release, and the refresh automation doesn't run it. The native packages (cryptography, PyNaCl, bcrypt, pyOpenSSL, cffi, pycparser) are the `@ai-ecoverse/py-*` pins in its `package.json`, not PyPI files: the lock names them, so a bump fetches no wheel for them, and moving one of those pins needs `lock.py` again too. `can-launch-browser-wasi.patch` may need a refresh |
| bash | savannah `bash.git` | tags `bash-X.Y` |
| cmake | `Kitware/CMake` | github-releases |
| coreutils | savannah `coreutils.git` | |
| binutils | `mirrors.kernel.org/gnu/binutils/` | `custom.binutils` (html listing): tags are `binutils-2_47` |
| curl | `curl.se/download/` | `custom.curl` (html listing): tags are `curl-X_Y_Z` |
| diffutils | savannah `diffutils.git` | |
| freetype | `download.savannah.gnu.org/releases/freetype/` | `custom.freetype` (html listing): tags are `VER-X-Y-Z` |
| gawk | savannah `gawk.git` | |
| gcloud-cli | `dl.google.com/dl/cloudsdk/channels/rapid/components-2.json` | `custom.google-cloud-sdk` (json, the release in `version`); the recipe pins `components-v<version>.json`, and build.sh checks each component tarball against it |
| git | `git/git` | github-releases |
| gmake | savannah `make.git` | |
| grep | savannah `grep.git` | |
| gzip | savannah `gzip.git` | |
| imagemagick | `ImageMagick/ImageMagick` | loose versioning |
| lcms2 | `mm2/Little-CMS` | tags `lcms2.*` |
| less | `gwsw/less` | tags `vNNN` |
| libjpeg-turbo | `libjpeg-turbo/libjpeg-turbo` | github-releases |
| libpng | `pnggroup/libpng` | github-tags; locked to 1.6.x |
| libtiff | `libsdl-org/libtiff` | github-tags (GitHub mirror) |
| libwebp | `webmproject/libwebp` | github-tags |
| libxml2 | `GNOME/libxml2` | github-tags |
| openjpeg | `uclouvain/openjpeg` | github-releases |
| patch | savannah `patch.git` | |
| picocom | gitlab `wsakernel/picocom` | gitlab-releases, tags `YYYY-MM`; npm gets `YYYY.M.0-N` (docs/versioning.md) |
| pkgconf | `pkgconf/pkgconf` | tags `pkgconf-*` |
| sed | savannah `sed.git` | |
| sqlite3 | `sqlite/sqlite` | tags `version-X.Y.Z` |
| tar | savannah `tar.git` | |
| tls-engine | `Mbed-TLS/mbedtls` | tags `mbedtls-X.Y.Z` |
| tzdata | `data.iana.org/time-zones/releases/` | `custom.tzdata` (html listing, `versioning=loose`): releases are `2026f`; npm gets `2026.6.0-N` (docs/versioning.md) |
| wasix-openssl, wasix-openssl-cli | `openssl/openssl` | github-releases, tags `openssl-3.5.Z` (the 3.5 LTS line); one branch bumps both recipes. wasix-openssl-cli's roots follow `curl-cacert` with tls-engine's |
| wasi-fastly | `fastly/cli` | github-releases, tags `vX.Y.Z` (`extractVersion=^v(?<version>.*)$`); the source is the tag's commit archive (`tag: v{{version}}`), which the refresh re-pins |
| wasi-quickjs | `quickjs-ng/quickjs` | github-releases, tags `vX.Y.Z` (`extractVersion=^v(?<version>.*)$`) |
| xxd | `vim/vim` | tags `vX.Y.Z` (vim patch level) |
| zlib | `madler/zlib` | github-releases |

**Tags Renovate can't read.** `extractVersion` keeps only its `version`
group, so it can't turn `binutils-2_47`, `curl-8_22_0` or `VER-2-13-3` into
a version: a `major`/`minor`/`patch` pattern there drops every release, and
the pin never moves. Those recipes read the upstream's release directory
instead, through a `customDatasources` entry in `renovate.json` with
`"format": "html"` (each link is a candidate) and an `extractVersion` on the
tarball's file name:

```yaml
# renovate: datasource=custom.binutils depName=binutils extractVersion=^binutils-(?<version>\d+\.\d+(?:\.\d+)?)\.tar\.xz$
version: "2.47"
```

`scripts/test/renovate-pins.test.mjs` checks every recipe's comment against
the manager's regex: the `version:` it captures, a `version` group in each
`extractVersion`, and a `customDatasources` entry for each `custom.*`.

Intentionally untracked: `ffmpeg` (retired), `zip` (Info-ZIP 3.0 frozen),
`magick-native` (removed — ABI mismatch with `@imagemagick/magick-wasm`;
npm name deprecated).

**Shipped manifests.** Renovate doesn't update `@ai-ecoverse/*`
dependencies in `packages/*/package/package.json`. A re-pin there changes a
shipped manifest without a new packaging revision, so `npm-parity` fails it
(#1702, #1703, #1707, #1708, #1709); the builder re-pins at the package's
next `-N`. Their other dependencies keep their ranges (`rangeStrategy:
replace`). The root `package.json` test pins (cert kernel, shared-web,
playwright) keep updating. `scripts/test/renovate-ranges.test.mjs` checks
both.

**Workflow actions.** Action and pin bumps in `.github/workflows/ladder-*.yml`
(the publish path) stay manual, with one exception: minors and patches of the
`ai-ecoverse/slicc-shared-web/.github/actions/memory-peak` steps in
`ladder-build.yml` automerge. Every memory-peak step is `if: always()` +
`continue-on-error: true` and only prints the memory peak (#1715, #1734,
#1742, #1745, #1753 were armed by hand). Renovate names those steps and the
`pipeline.yml` reusable-workflow pin both `ai-ecoverse/slicc-shared-web`; the
rule matches `depType: action` (a step), never `workflow` (the pipeline pin),
so the pipeline pin stays manual, and a `slicc-shared-web` branch that moves
both stays manual too. `scripts/test/renovate-ranges.test.mjs` checks it.

The Renovate GitHub App is installed org-wide on `ai-ecoverse`.
