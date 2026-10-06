#!/bin/sh
# Shared launcher for emcc/em++/emar/… — runs em*.py on wasix-python (-S).
# Self-sufficient when invoked by path (emcmake toolchain uses $PKG/emcc).
set -eu

TOOL=$(basename "$0")
BINDIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)

# $PKG/emcc (cmake / path_from_root) → package root is BINDIR.
# $PKG/bin/emcc (slicc.commands) → package root is parent.
if [ -f "$BINDIR/emcc.py" ]; then
  PKG_ROOT=$BINDIR
  ENSURE_CACHE=$BINDIR/bin/em-ensure-cache
elif [ -f "$BINDIR/../emcc.py" ]; then
  PKG_ROOT=$(CDPATH= cd -- "$BINDIR/.." && pwd)
  ENSURE_CACHE=$BINDIR/em-ensure-cache
else
  PKG_ROOT=${EM_PACKAGE_ROOT:-$BINDIR}
  ENSURE_CACHE=$BINDIR/em-ensure-cache
fi

export EM_PACKAGE_ROOT=${EM_PACKAGE_ROOT:-$PKG_ROOT}
export EM_CONFIG=${EM_CONFIG:-$PKG_ROOT/emscripten-config}

# Resolve companion packages when slicc.env did not set them.
: "${EM_CACHE_PACKAGE:=/shared/lib/node_modules/@ai-ecoverse/emscripten-cache}"
: "${EM_LLVM_PACKAGE:=/shared/lib/node_modules/@ai-ecoverse/wasm-clang}"
: "${EM_BINARYEN_PACKAGE:=/shared/lib/node_modules/@ai-ecoverse/wasm-binaryen}"
export EM_CACHE_PACKAGE EM_LLVM_PACKAGE EM_BINARYEN_PACKAGE

# Writable user CACHE + sysroot symlink into emscripten-cache.
if [ ! -x "$ENSURE_CACHE" ]; then
  echo "em-launcher: missing $ENSURE_CACHE" >&2
  exit 1
fi
CACHE=$("$ENSURE_CACHE")
export EM_CACHE=$CACHE

# libslicc objects for default executable links (link.py); not the node-realm VFS pre-js.
export SLICC_EM_LIBDIR=${SLICC_EM_LIBDIR:-$PKG_ROOT/lib/slicc}
# Do NOT default-export SLICC_VFS_PRE_JS — that pre-js reads process.env.SLICC_LIVE_FS
# (node-realm only) and breaks wasm-realm runnables. Opt in explicitly if needed.

PY=${EMSDK_PYTHON:-}
if [ -z "$PY" ]; then
  PY=$(command -v python3 2>/dev/null || true)
fi
if [ -z "$PY" ]; then
  PY=$(command -v python 2>/dev/null || true)
fi
if [ -z "$PY" ]; then
  echo "em-launcher: unable to find python3 (need @ai-ecoverse/wasix-python)" >&2
  exit 1
fi

SCRIPT=$PKG_ROOT/${TOOL}.py
if [ ! -f "$SCRIPT" ]; then
  case $TOOL in
    em++) SCRIPT=$PKG_ROOT/em++.py ;;
  esac
fi
if [ ! -f "$SCRIPT" ]; then
  echo "em-launcher: missing $SCRIPT" >&2
  exit 1
fi

# -S: no site-packages from a host install; wasix-python is self-contained.
exec "$PY" -S "$SCRIPT" "$@"
