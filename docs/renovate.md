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

## Coverage

| package | upstream | notes |
| --- | --- | --- |
| zlib | `madler/zlib` | github-releases |
| libjpeg-turbo | `libjpeg-turbo/libjpeg-turbo` | github-releases |
| libpng | `pnggroup/libpng` | git-tags; locked to 1.6.x |
| lcms2 | `mm2/Little-CMS` | tags `lcms2.*` |
| libtiff | `libsdl-org/libtiff` | git-tags (GitHub mirror) |
| libwebp | `webmproject/libwebp` | git-tags |
| openjpeg | `uclouvain/openjpeg` | github-releases |
| libxml2 | `GNOME/libxml2` | git-tags |
| pkgconf | `pkgconf/pkgconf` | tags `pkgconf-*` |
| imagemagick | `ImageMagick/ImageMagick` | loose versioning |
| freetype | — | tags are `VER-2-13-3`; mapping TBD |

The Renovate GitHub App is installed org-wide on `ai-ecoverse`.
