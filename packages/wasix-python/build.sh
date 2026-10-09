#!/usr/bin/env bash
# CPython 3.14 for slicc WASIX — stage bin/python.wasm + pruned lib/python3.14.
# Full cross-build expects wasixcc on PATH and a prior host python3.14.
# For a local republish of a verified stage tree, set WASIX_PYTHON_STAGE.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-python

DEST="$HOMESCOOP_PKG/package"
STAGE="${WASIX_PYTHON_STAGE:-$WORK/wasix-python-${VER}/stage}"
# Packaging-only (no WASIX_PYTHON_STAGE): the published tarball named by
# recipe sources.base is the stage, byte for byte (bin, lib incl. its .pyc,
# include); stdlib/ files are added on top. The full cross-build is not
# automated (HOMESCOOP-5e.md), and CI has no CPython 3.14 to recompile with.
PACKAGING_ONLY=

if [[ -n "${WASIX_PYTHON_STAGE:-}" && -f "$WASIX_PYTHON_STAGE/bin/python.wasm" ]]; then
  echo "== wasix-python: using prebuilt stage $WASIX_PYTHON_STAGE"
  STAGE="$WASIX_PYTHON_STAGE"
else
  homescoop_load_recipe wasix-python --source base
  BASE_TGZ="$WORK/$(basename "$BASE_SRC_URL")"
  BASE_DIR="$WORK/wasix-python-base"
  homescoop_fetch "$BASE_SRC_URL" "$BASE_SRC_SHA" "$BASE_TGZ"
  rm -rf "$BASE_DIR" && mkdir -p "$BASE_DIR"
  tar -xzf "$BASE_TGZ" -C "$BASE_DIR"
  STAGE="$BASE_DIR/package"
  PACKAGING_ONLY=1
  echo "== wasix-python: packaging-only from $(basename "$BASE_TGZ")"
fi

test -f "$STAGE/bin/python.wasm"
test -d "$STAGE/lib/python3.14"

echo "== wasix-python: stage into package/"
mkdir -p "$DEST/bin" "$DEST/lib"
rsync -a --delete "$STAGE/bin/" "$DEST/bin/"
rsync -a --delete "$STAGE/lib/" "$DEST/lib/"
if [[ -n "$PACKAGING_ONLY" ]]; then
  mkdir -p "$DEST/include"
  rsync -a --delete "$STAGE/include/" "$DEST/include/"
fi
# slicc additions (shipped without .pyc): stdlib modules (sitecustomize.py,
# _slicc_site.py) and .pth hooks in the base site-packages.
ADDED=()
for f in "$HOMESCOOP_PKG"/stdlib/*.py; do
  cp "$f" "$DEST/lib/python3.14/"
  ADDED+=("$DEST/lib/python3.14/$(basename "$f")")
done
for f in "$HOMESCOOP_PKG"/stdlib/site-packages/*.pth; do
  cp "$f" "$DEST/lib/python3.14/site-packages/"
done

# Stdlib patches (subprocess/site/sysconfig) may land after the stage's
# compileall. unchecked-hash .pyc never revalidate against .py — wipe and
# recompile as the last step so the shipped bytecode matches source.
PYLIB="$DEST/lib/python3.14"
if [[ -n "$PACKAGING_ONLY" ]]; then
  # Keep the base's .pyc as published; check they still cover every .py.
  stale=0
  while IFS= read -r -d '' py; do
    for a in "${ADDED[@]}"; do [[ "$py" == "$a" ]] && continue 2; done
    dir=$(dirname "$py"); base=$(basename "$py" .py); pyc=""
    for cand in "$dir/__pycache__/${base}".cpython-*.pyc; do
      if [[ -f "$cand" ]]; then pyc=$cand; break; fi
    done
    if [[ -z "$pyc" ]]; then echo "homescoop: missing pyc for $py" >&2; stale=1; fi
  done < <(find "$PYLIB" -name '*.py' -print0)
  [[ "$stale" -eq 0 ]] || exit 1
elif [[ -d "$PYLIB" ]]; then
  echo "== wasix-python: recompile stdlib (unchecked-hash)"
  find "$PYLIB" -type d -name '__pycache__' -prune -exec rm -rf {} +
  HOST_PY="${WASIX_PYTHON_HOST_PY:-}"
  if [[ -z "$HOST_PY" ]]; then
    if command -v python3.14 >/dev/null 2>&1; then
      HOST_PY=$(command -v python3.14)
    else
      HOST_PY=$(command -v python3)
    fi
  fi
  "$HOST_PY" -m compileall -q --invalidation-mode unchecked-hash "$PYLIB"
  # Fail if any .py is newer than its sibling .pyc (patch-after-compileall slip).
  stale=0
  while IFS= read -r -d '' py; do
    dir=$(dirname "$py")
    base=$(basename "$py" .py)
    # Prefer __pycache__/<base>.cpython-*.pyc
    pyc=""
    for cand in "$dir/__pycache__/${base}".cpython-*.pyc; do
      if [[ -f "$cand" ]]; then pyc=$cand; break; fi
    done
    if [[ -z "$pyc" || "$py" -nt "$pyc" ]]; then
      echo "homescoop: stale/missing pyc for $py" >&2
      stale=1
    fi
  done < <(find "$PYLIB" -name '*.py' -print0)
  if [[ "$stale" -ne 0 ]]; then
    exit 1
  fi
fi

if [[ ! -f "$DEST/LICENSE" ]]; then
  if [[ -f "${WASIX_PYTHON_BUILD:-/tmp/wasix-python-build}/Python-${VER}/LICENSE" ]]; then
    cp "${WASIX_PYTHON_BUILD:-/tmp/wasix-python-build}/Python-${VER}/LICENSE" "$DEST/LICENSE"
  else
    echo "homescoop: missing CPython LICENSE" >&2
    exit 1
  fi
fi

chmod 755 "$DEST/bin/python.wasm" || true

# Blocking static PRESTAGE (SOABI + getuid wrap)
ROOT_PKG="$(cd "$(dirname "$0")" && pwd)"
if [[ -n "$PACKAGING_ONLY" ]]; then
  # The base passed PRESTAGE when it was built; the wasm must be its bytes.
  cmp "$STAGE/bin/python.wasm" "$DEST/bin/python.wasm"
  echo "== wasix-python: bin/python.wasm identical to $(basename "$BASE_TGZ")"
else
  bash "$ROOT_PKG/prestage-check.sh" "$DEST/bin/python.wasm" "$DEST/lib/python3.14"
fi
echo "== wasix-python: staged $(du -sh "$DEST" | awk '{print $1}')"
