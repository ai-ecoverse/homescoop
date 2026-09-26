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
# Prefer a local packages/*/package tree when the npm version is not on the
# registry yet (same-repo ladder builds).
is_npm_spec() {
  local s="$1"
  [[ "$s" == @* ]] && return 0
  [[ "$s" =~ @[0-9] ]] && return 0
  [[ "$s" == *@latest ]] && return 0
  return 1
}

# Resolve @ai-ecoverse/wasm-foo@1.2.3 → packages/foo/package when present.
local_wasm_pkg_dir() {
  local spec="$1"
  local name ver dir
  if [[ "$spec" =~ ^@ai-ecoverse/wasm-([a-z0-9-]+)(@(.+))?$ ]]; then
    name="${BASH_REMATCH[1]}"
    dir="$ROOT/packages/$name/package"
    if [[ -d "$dir" && -f "$dir/package.json" ]]; then
      echo "$dir"
      return 0
    fi
  fi
  return 1
}

while IFS= read -r spec; do
  [[ -z "$spec" ]] && continue
  if ! is_npm_spec "$spec"; then
    echo "== host-run: skip mamba/forge dep '$spec' (use slicc builder / ipk mamba)"
    continue
  fi
  tmp="$(mktemp -d)"
  (
    cd "$tmp"
    if local_dir="$(local_wasm_pkg_dir "$spec")"; then
      echo "== host-run: local pack $local_dir → $PREFIX"
      npm pack "$local_dir" --silent
    else
      echo "== host-run: npm pack $spec → $PREFIX"
      npm pack "$spec" --silent
    fi
    tar xzf ./*.tgz
    if [[ -d package/lib ]]; then cp -R package/lib/. "$PREFIX/lib/"; fi
    if [[ -d package/include ]]; then cp -R package/include/. "$PREFIX/include/"; fi
    if [[ -d package/package/lib ]]; then cp -R package/package/lib/. "$PREFIX/lib/"; fi
    if [[ -d package/package/include ]]; then cp -R package/package/include/. "$PREFIX/include/"; fi
  )
  rm -rf "$tmp"
done < <(node "$ROOT/scripts/read-recipe.mjs" "$name" --deps || true)


# Ensure emcc: prefer PATH, else activate emsdk npm package (caches under
# ~/Library/Caches/emsdk). Optional override: HOMESCOOP_EMSDK_ROOT + EM_CONFIG.
if ! command -v emconfigure >/dev/null 2>&1; then
  if [[ -n "${HOMESCOOP_EMSDK_ROOT:-}" && -x "$HOMESCOOP_EMSDK_ROOT/emcc" ]]; then
    export PATH="$HOMESCOOP_EMSDK_ROOT:$PATH"
  else
    echo "== host-run: installing emsdk (npm)"
    if [[ ! -d "$ROOT/node_modules/emsdk" ]]; then
      (cd "$ROOT" && npm install --no-save --no-package-lock emsdk@0.4.0)
    fi
    # shellcheck disable=SC1091
    eval "$(node -e 'const e=require("emsdk"); const env=e.env(); for (const [k,v] of Object.entries(env)) console.log(`export ${k}=${JSON.stringify(String(v))}`)')"
  fi
fi
command -v emconfigure >/dev/null
command -v emmake >/dev/null
command -v emcc >/dev/null
emcc --version | head -1

# Prefer GNU make (Homebrew `make` formula → gmake). BSD make breaks
# autoconf dependency-tracking and FreeType.
if command -v gmake >/dev/null 2>&1; then
  export MAKE=gmake
elif [[ -x /opt/homebrew/opt/make/bin/gmake ]]; then
  export MAKE=/opt/homebrew/opt/make/bin/gmake
  export PATH="/opt/homebrew/opt/make/bin:$PATH"
fi
if [[ -n "${MAKE:-}" ]]; then
  echo "== host-run: MAKE=$MAKE"
fi

echo "== host-run: build.sh ($name)"
bash "$PKG/build.sh"

echo "== host-run: npm pack"
mkdir -p "$OUT"
tgz="$(npm pack "$PKG/package" --pack-destination "$OUT" | tail -1)"
cp "$OUT/$tgz" "$OUT/package.tgz"
echo "== host-run: $OUT/package.tgz"
