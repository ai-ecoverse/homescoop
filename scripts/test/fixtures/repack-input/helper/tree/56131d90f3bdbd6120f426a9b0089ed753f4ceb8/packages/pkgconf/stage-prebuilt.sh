#!/usr/bin/env bash
# PLANTED (repack-input.test.mjs): the py-pandas shape, one level down.
set -euo pipefail
STAGE="${WASIX_PKGCONF_STAGE:-$WORK/stage}"
if [[ -d "$STAGE/bin" ]]; then
  rsync -a --delete "$STAGE/" "$HOMESCOOP_PKG/package/"
fi
