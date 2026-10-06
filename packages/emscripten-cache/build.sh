#!/usr/bin/env bash
# Stage the host-built Emscripten sysroot as @ai-ecoverse/emscripten-cache.
# Does not ship js_output/ or symbol_lists/ — those regenerate under the
# writable user CACHE (see @ai-ecoverse/wasm-emscripten README).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/emscripten-cache"
VERSION="6.0.9"
PKG_VER="6.0.9-3"
PKG="$HOMESCOOP_PKG/package"
SLICC_EM="${SLICC_EMSCRIPTEN:-$ROOT/../slicc-emscripten}"
SYSROOT_SRC="${EM_SYSROOT_SRC:-$SLICC_EM/cache/sysroot}"
STAMP_SRC="${EM_STAMP_SRC:-$SLICC_EM/cache/sysroot_install.stamp}"

test -d "$SYSROOT_SRC/lib" || {
  echo "homescoop: missing $SYSROOT_SRC (build embuilder cache first)" >&2
  exit 1
}
test -d "$SYSROOT_SRC/include" || {
  echo "homescoop: missing $SYSROOT_SRC/include" >&2
  exit 1
}

echo "== emscripten-cache: stage sysroot → package ($PKG_VER)"
rm -rf "$PKG/sysroot" "$PKG/stamps"
mkdir -p "$PKG" "$PKG/stamps"
# Real tree copy (no symlinks) — npm/ipk skip links.
rsync -a --delete --copy-links "$SYSROOT_SRC/" "$PKG/sysroot/"
homescoop_assert_no_package_links "$PKG/sysroot"

# Refuse shipping the stride-20 sigset_t layout.
if grep -q '__bits\[2\]' "$PKG/sysroot/include/bits/alltypes.h"; then
  echo "homescoop: staged sysroot has sigset_t __bits[2] (stride-20 trap)" >&2
  exit 1
fi
grep -q '__bits\[128/sizeof(long)\]' "$PKG/sysroot/include/bits/alltypes.h"

# Drop any accidental lock / js_output under sysroot (should not exist).
rm -rf "$PKG/sysroot/js_output" "$PKG/sysroot/symbol_lists" "$PKG/sysroot/cache.lock"

# Tiny stamps for the writable user EM_CACHE (copied by em-ensure-cache).
# Without sysroot_install.stamp, emcc tries to reinstall headers through the
# sysroot symlink into this package.
if [[ -f "$STAMP_SRC" ]]; then
  cp "$STAMP_SRC" "$PKG/stamps/sysroot_install.stamp"
else
  # Upstream content is a single 'x'
  printf 'x' > "$PKG/stamps/sysroot_install.stamp"
fi

cp "$SLICC_EM/src/emscripten/LICENSE" "$PKG/LICENSE"

# Stamp so launchers can verify ABI / refuse mismatched trees.
printf '%s\n' "$PKG_VER" > "$PKG/sysroot/.homescoop-emscripten-cache"
printf '%s\n' "$(cat "$SLICC_EM/src/emscripten/emscripten-version.txt")" > "$PKG/EMSCRIPTEN_VERSION"

cat > "$PKG/README.md" <<'EOF'
# @ai-ecoverse/emscripten-cache

Prebuilt Emscripten **sysroot** (headers + libs) for SLICC's `emcc`.

## Layout

- `sysroot/` — read-only package content (~99MB)
- `stamps/sysroot_install.stamp` — copied into the writable user `EM_CACHE` by
  `em-ensure-cache` so emcc never reinstalls headers through the sysroot symlink

## Runtime CACHE (not this package)

`@ai-ecoverse/wasm-emscripten` sets `EM_CACHE` to a **writable user dir**
(default `$XDG_CACHE_HOME/emscripten` or `~/.cache/emscripten`) and makes
`$EM_CACHE/sysroot` a **symlink** into this package. That means:

- No 100MB copy on install or first use
- `js_output/` and `symbol_lists/` warm in the user dir (survive `ipk` reinstall)
- Reinstall refreshes the symlink target; user warm state is kept

Do not set `CACHE` to this package directory.
EOF

node - "$PKG" "$PKG_VER" <<'JS'
const fs = require("fs");
const path = require("path");
const pkgDir = process.argv[2];
const ver = process.argv[3];
const j = {
  name: "@ai-ecoverse/emscripten-cache",
  version: ver,
  description: "Prebuilt Emscripten 6.0.9 sysroot for slicc (read-only seed)",
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/ai-ecoverse/homescoop.git",
    directory: "packages/emscripten-cache/package",
  },
  homepage: "https://github.com/ai-ecoverse/homescoop/tree/main/packages/emscripten-cache",
  keywords: ["wasm", "emscripten", "slicc", "homescoop", "sysroot"],
  files: ["README.md", "LICENSE", "EMSCRIPTEN_VERSION", "sysroot", "stamps"],
  publishConfig: { access: "public" },
  homescoop: { recipe: "emscripten-cache", upstream: "6.0.9" },
  slicc: { abi: "emscripten" },
};
fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(j, null, 2) + "\n");
JS

echo "== emscripten-cache: sizes"
du -sh "$PKG" "$PKG/sysroot" "$PKG/stamps"

echo "== emscripten-cache: PRESTAGE pack (no links)"
homescoop_assert_no_package_links "$PKG"
TGZ=$(homescoop_npm_pack_no_links "$PKG" "$HOMESCOOP_PKG")
STAGE="$ROOT/staging/emscripten-acceptance"
if [[ -d "$STAGE" ]]; then
  cp "$TGZ" "$STAGE/"
fi
echo "STAGED: $TGZ"
ls -lh "$TGZ"
