# Renovate — upstream recipe bumps

Renovate (`renovate.json`) watches `packages/*/recipe.yaml` via a regex
manager. Each recipe pins its upstream with a comment:

```yaml
# renovate: datasource=github-releases depName=madler/zlib extractVersion=^v(?<version>.*)$
version: "1.3.1"
```

When upstream cuts a release, Renovate opens a PR labeled `homescoop-recipe`
(no automerge). CI:

1. **`ladder-pr`** — host-builds each touched `packages/<name>` on the PR
   (no publish). Slicc builders are noted and skipped.
2. **`ladder-merge`** — after merge to `main`, dispatches `ladder-build` for
   each touched package (`createWorkflowDispatch`, not a reusable
   `workflow_call` — npm OIDC trusts the calling workflow filename).
   `sync-package-version.mjs` aligns `package.json` with the new recipe
   version before packing.

Manual: `gh workflow run ladder-build.yml -f package=zlib`.

Renovate only rewrites the `version:` line. When merging a recipe bump,
also update `source.url` / `source.sha256` (and any hardcoded version in
`build.sh`) to match, then let ladder rebuild.

## Coverage

| package | upstream | notes |
| --- | --- | --- |
| bash | savannah `bash.git` | tags `bash-X.Y` |
| cmake | `Kitware/CMake` | github-releases |
| coreutils | savannah `coreutils.git` | |
| curl | `curl/curl` | tags `curl-X_Y_Z` → `X.Y.Z` |
| diffutils | savannah `diffutils.git` | |
| freetype | freedesktop `freetype.git` | tags `VER-X-Y-Z` → `X.Y.Z` |
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

Intentionally untracked: `ffmpeg` (retired), `zip` (Info-ZIP 3.0 frozen),
`magick-native` (calendar / Magick.Native pin, not a single upstream tarball).

The Renovate GitHub App is installed org-wide on `ai-ecoverse`.
