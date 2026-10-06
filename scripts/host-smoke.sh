#!/usr/bin/env bash
# host-smoke.sh <package> — emcc-link packages/<name>/smoke.c against PREFIX.
# No-op when smoke.c is absent. Used by ladder-pr after host-run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
name="${1:?usage: host-smoke.sh <package>}"
SMOKE="$ROOT/packages/$name/smoke.c"
if [[ ! -f "$SMOKE" ]]; then
  echo "host-smoke: no $SMOKE — skip"
  exit 0
fi

OUT="${HOMESCOOP_OUT:-$ROOT/.homescoop-out}"
PREFIX="${PREFIX:-$OUT/prefix}"
WORKDIR="${HOMESCOOP_SMOKE_DIR:-$OUT/smoke}"
mkdir -p "$WORKDIR"

if ! command -v emcc >/dev/null 2>&1; then
  if [[ -n "${HOMESCOOP_EMSDK_ROOT:-}" && -x "$HOMESCOOP_EMSDK_ROOT/emcc" ]]; then
    export PATH="$HOMESCOOP_EMSDK_ROOT:$PATH"
  elif [[ -d "$ROOT/node_modules/emsdk" ]]; then
    eval "$(node -e 'const e=require("emsdk"); const env=e.env(); for (const [k,v] of Object.entries(env)) console.log(`export ${k}=${JSON.stringify(String(v))}`')"
  else
    echo "host-smoke: emcc not on PATH" >&2
    exit 1
  fi
fi
command -v emcc >/dev/null

ldflags=()
if [[ -f "$ROOT/packages/$name/smoke.ldflags" ]]; then
  # shellcheck disable=SC2207
  ldflags=($(cat "$ROOT/packages/$name/smoke.ldflags"))
fi

echo "== host-smoke: emcc $name/smoke.c ${ldflags[*]:-}"
emcc -O0 "$SMOKE" \
  -I"$PREFIX/include" -L"$PREFIX/lib" \
  "${ldflags[@]}" \
  -sNODERAWFS=1 \
  -o "$WORKDIR/smoke.js"

echo "== host-smoke: node $WORKDIR/smoke.js"
node "$WORKDIR/smoke.js" "$WORKDIR"
echo "== host-smoke: $name OK"
