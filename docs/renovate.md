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
when only the root table is stale. For a Renovate PR the homescoop
coordinator's automation acts on those lines: it runs main's scripts on the
branch and pushes as a user, so the PR's run starts normally; anyone else runs the
printed command and pushes. A refreshed PR then carries the new version
everywhere; `check-package-meta.mjs` fails the build when any text still names
the old one (docs/versioning.md, "Upstream versions in text").

Manual publish of a merged recipe whose push published nothing: `gh workflow run ladder-build.yml -f packages=zlib`.

Renovate only rewrites `version:` lines. Recipe `source.url` (and
`sources.*.url`) must use `{{version}}` / `{{major}}` / `{{minor}}`
placeholders so the tarball URL tracks the bump (libxml2's GNOME path is
`{{major}}.{{minor}}/libxml2-{{version}}.tar.xz`; libpng stays on the
`libpng16/{{version}}` series). Do not hardcode `SRC_DIR` / `TARBALL`
versions in `build.sh` — `homescoop_load_recipe` sets them from the
recipe.

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
| bash | savannah `bash.git` | tags `bash-X.Y` |
| cmake | `Kitware/CMake` | github-releases |
| coreutils | savannah `coreutils.git` | |
| binutils | `mirrors.kernel.org/gnu/binutils/` | `custom.binutils` (html listing): tags are `binutils-2_47` |
| curl | `curl.se/download/` | `custom.curl` (html listing): tags are `curl-X_Y_Z` |
| diffutils | savannah `diffutils.git` | |
| freetype | `download.savannah.gnu.org/releases/freetype/` | `custom.freetype` (html listing): tags are `VER-X-Y-Z` |
| gawk | savannah `gawk.git` | |
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
| pkgconf | `pkgconf/pkgconf` | tags `pkgconf-*` |
| sed | savannah `sed.git` | |
| sqlite3 | `sqlite/sqlite` | tags `version-X.Y.Z` |
| tar | savannah `tar.git` | |
| tls-engine | `Mbed-TLS/mbedtls` | tags `mbedtls-X.Y.Z` |
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
