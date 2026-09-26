#!/usr/bin/env bash
# host-run.sh <package> — install recipe deps into $PREFIX, run build.sh, npm pack.
# Runs on a host with Node + emcc (via emsdk npm or system PATH).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
name="${1:?usage: host-run.sh <package>}"
PKG="$ROOT/packages/$name"
OUT="${HOMESCOOP_OUT:-$ROOT/.homescoop-out}"
PREFIX="${PREFIX:-$OUT/prefix}"
WORK="${HOMESCOOP_WORK:-$OUT/work}"
export HOMESCOOP_ROOT="$ROOT" PREFIX WORK

builder="$(node "$ROOT/scripts/read-recipe.mjs" "$name" --field builder || true)"
builder="${builder:-host}"
if [[ "$builder" != "host" ]]; then
  echo "host-run.sh: recipe builder is '$builder' (expected host)" >&2
  exit 2
fi
if [[ ! -f "$PKG/build.sh" ]]; then
  echo "missing $PKG/build.sh" >&2
  exit 1
fi

mkdir -p "$OUT" "$PREFIX/lib" "$PREFIX/include" "$WORK"

# Optional: unpack npm deps into PREFIX (headers + libs from prior rungs).
# Forge/mamba specs (name or name=ver) are slicc-only — skip on the host path.
is_npm_spec() {
  local s="$1"
  [[ "$s" == @* ]] && return 0
  [[ "$s" =~ @[0-9] ]] && return 0
  [[ "$s" == *@latest ]] && return 0
  return 1
}
while IFS= read -r spec; do
  [[ -z "$spec" ]] && continue
  if ! is_npm_spec "$spec"; then
    echo "== host-run: skip mamba/forge dep '$spec' (use slicc builder / ipk mamba)"
    continue
  fi
  echo "== host-run: npm pack $spec → $PREFIX"
  tmp="$(mktemp -d)"
  (
    cd "$tmp"
    npm pack "$spec" --silent
    tar xzf ./*.tgz
    # Prefer package/lib + package/include layout from homescoop publishes
    if [[ -d package/lib ]]; then cp -R package/lib/. "$PREFIX/lib/"; fi
    if [[ -d package/include ]]; then cp -R package/include/. "$PREFIX/include/"; fi
    # Some tarballs nest under package/
    if [[ -d package/package/lib ]]; then cp -R package/package/lib/. "$PREFIX/lib/"; fi
    if [[ -d package/package/include ]]; then cp -R package/package/include/. "$PREFIX/include/"; fi
  )
  rm -rf "$tmp"
done < <(node "$ROOT/scripts/read-recipe.mjs" "$name" --deps || true)

# Ensure emcc: prefer PATH, else activate emsdk from node_modules / npx cache.
if ! command -v emconfigure >/dev/null 2>&1; then
  echo "== host-run: installing emsdk (native toolchain)"
  if [[ ! -d "$ROOT/node_modules/emsdk" ]]; then
    (cd "$ROOT" && npm install --no-save --no-package-lock emsdk@4.0.23)
  fi
  # shellcheck disable=SC1091
  eval "$(node -e 'const e=require("emsdk"); const env=e.env(); for (const [k,v] of Object.entries(env)) console.log(`export ${k}=${JSON.stringify(v)}`)')"
fi
command -v emconfigure >/dev/null
command -v emmake >/dev/null

echo "== host-run: build.sh ($name)"
bash "$PKG/build.sh"

echo "== host-run: npm pack"
mkdir -p "$OUT"
tgz="$(npm pack "$PKG/package" --pack-destination "$OUT" | tail -1)"
cp "$OUT/$tgz" "$OUT/package.tgz"
echo "== host-run: $OUT/package.tgz"
