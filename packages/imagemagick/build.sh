#!/usr/bin/env bash
# Host body for imagemagick — not used while recipe.builder is slicc.
# When implemented: link with LDFLAGS="$(homescoop_em_cli_ldflags)" from
# scripts/build-common.sh; stage bin/magick{.wasm} and keep package.json
# slicc.commands in sync (argv0 for convert/identify/mogrify).
echo "homescoop: packages/imagemagick/build.sh not implemented (builder: slicc)" >&2
exit 1
