# Renovate — upstream recipe bumps

Renovate (`renovate.json`) watches `packages/*/recipe.yaml` via a regex
manager. Each recipe pins its upstream with a comment:

```yaml
# renovate: datasource=github-releases depName=madler/zlib extractVersion=^v(?<version>.*)$
version: "1.3.1"
```

When upstream cuts a release, Renovate opens a PR labeled `homescoop-recipe`
(no automerge). After merge: rebuild the WASM artifacts, bump the npm
`package/` version, and dispatch `.github/workflows/release.yml`.

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
