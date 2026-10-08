#!/usr/bin/env bash
# install-emsdk.sh — pinned Emscripten 4.0.23 for host builds.
#
# Replaces `npm install emsdk@0.4.0`. That package's postinstall resolves its
# download before the write stream has flushed, untars a truncated archive and
# swallows tar's error as long as emscripten/emcc exists. install/bin/wasm-opt
# is the last archive member, so it ends up truncated on most CI runners and
# emcc links that run wasm-opt (-O1+, -g) fail at random mid-emconfigure.
#
# Same release, install path and .emscripten config as emsdk@0.4.0, so build
# output is unchanged. The archive is sha256-pinned and tar must succeed
# before the stamp is written.
#
# Prints shell exports (EMSDK, EM_CONFIG, PATH) on stdout:
#   eval "$(bash scripts/install-emsdk.sh)"
set -euo pipefail

# emscripten-releases hash for 4.0.23 (same as emsdk@0.4.0 RELEASE_HASH).
RELEASE_HASH="aaa43392544d695232b70eda706d751f18980c2a"
BASE="https://storage.googleapis.com/webassembly/emscripten-releases-builds"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    URL="$BASE/linux/$RELEASE_HASH/wasm-binaries.tar.xz"
    SHA="5f1565fe45a1223cedf3b0300f5089c2c64954d2895b2aaedc85043c719be965"
    CACHE_BASE="${XDG_CACHE_HOME:-$HOME/.cache}/emsdk"
    ;;
  Darwin-arm64)
    URL="$BASE/mac/$RELEASE_HASH/wasm-binaries-arm64.tar.xz"
    SHA="54234e108d6612eca5dc9280d1779ccec3d49ad4d8c8562a6b2046b0a5a8d5d4"
    CACHE_BASE="${XDG_CACHE_HOME:-$HOME/Library/Caches}/emsdk"
    ;;
  *)
    echo "install-emsdk: unsupported host $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

# emsdk@0.4.0 layout: <cache>/0.4.0/{install,.emscripten}
ROOT="${EMSDK_CACHE:-$CACHE_BASE}/0.4.0"
INSTALL="$ROOT/install"
STAMP="$ROOT/.homescoop-emsdk"
NODE="$(node -p process.execPath)"

if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$RELEASE_HASH" ]]; then
  echo "== install-emsdk: $ROOT already has $RELEASE_HASH" >&2
else
  echo "== install-emsdk: fetch $URL" >&2
  mkdir -p "$ROOT"
  TMP="$(mktemp -d "$ROOT/.tmp.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$URL" -o "$TMP/wasm-binaries.tar.xz"
  echo "$SHA  $TMP/wasm-binaries.tar.xz" | shasum -a 256 -c - >&2
  mkdir -p "$TMP/install"
  tar -xf "$TMP/wasm-binaries.tar.xz" --strip-components=1 -C "$TMP/install"
  rm -rf "$INSTALL"
  mv "$TMP/install" "$INSTALL"
  echo "$RELEASE_HASH" > "$STAMP"
  echo "== install-emsdk: installed $RELEASE_HASH → $INSTALL" >&2
fi

# Same config emsdk@0.4.0 writes. NODE_JS follows the node on PATH, as the
# npm postinstall's process.execPath did; only rewrite when it changes.
CONFIG="EMSCRIPTEN_ROOT = '$INSTALL/emscripten'
LLVM_ROOT = '$INSTALL/bin'
BINARYEN_ROOT = '$INSTALL'
NODE_JS = '$NODE'"
if [[ ! -f "$ROOT/.emscripten" || "$(cat "$ROOT/.emscripten")" != "$CONFIG" ]]; then
  printf '%s\n' "$CONFIG" > "$ROOT/.emscripten"
fi

cat <<EOF
export EMSDK=$(printf %q "$ROOT")
export EM_CONFIG=$(printf %q "$ROOT/.emscripten")
export PATH=$(printf %q "$INSTALL/emscripten"):$(printf %q "$INSTALL/bin"):\$PATH
EOF
