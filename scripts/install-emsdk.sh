#!/usr/bin/env bash
# install-emsdk.sh — pinned Emscripten 4.0.23 for host builds.
#
# Replaces `npm install emsdk@0.4.0`. That package's postinstall resolves its
# download before the write stream has flushed, untars a truncated archive and
# swallows tar's error as long as emscripten/emcc exists. install/bin/wasm-opt
# is the last archive member, so it ends up truncated on most CI runners and
# emcc links that run wasm-opt (-O1+, -g) fail at random mid-emconfigure.
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

PATCH_DIR="$(cd "$(dirname "$0")" && pwd)/emsdk-patches"
PATCHES=()
for patch_file in "$PATCH_DIR"/*.patch; do
  [[ -f "$patch_file" ]] || continue
  PATCHES+=("$patch_file")
done
if ((${#PATCHES[@]})); then
  PATCHSET="$(for patch_file in "${PATCHES[@]}"; do printf '%s %s\n' "$(basename "$patch_file")" "$(shasum -a 256 < "$patch_file" | cut -d' ' -f1)"; done | shasum -a 256 | cut -c1-8)"
  ROOT="${EMSDK_CACHE:-$CACHE_BASE}/0.4.0-$PATCHSET"
else
  PATCHSET=none
  ROOT="${EMSDK_CACHE:-$CACHE_BASE}/0.4.0"
fi
INSTALL="$ROOT/install"
STAMP="$ROOT/.homescoop-emsdk"
WANT="$RELEASE_HASH patches=$PATCHSET"
NODE="$(node -p process.execPath)"

if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$WANT" ]]; then
  echo "== install-emsdk: $ROOT already has $WANT" >&2
else
  echo "== install-emsdk: fetch $URL" >&2
  mkdir -p "$ROOT"
  rm -f "$STAMP"
  TMP="$(mktemp -d "$ROOT/.tmp.XXXXXX")"
  trap 'rm -rf "$TMP"' EXIT
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$URL" -o "$TMP/wasm-binaries.tar.xz"
  echo "$SHA  $TMP/wasm-binaries.tar.xz" | shasum -a 256 -c - >&2
  mkdir -p "$TMP/install"
  tar -xf "$TMP/wasm-binaries.tar.xz" --strip-components=1 -C "$TMP/install"
  for patch_file in ${PATCHES[@]+"${PATCHES[@]}"}; do
    patch -d "$TMP/install/emscripten" -p1 -s -f --no-backup-if-mismatch < "$patch_file" >&2
    echo "== install-emsdk: applied $(basename "$patch_file")" >&2
  done
  if ((${#PATCHES[@]})); then
    rm -f "$TMP/install/emscripten/cache/sysroot/lib/wasm32-emscripten"/libc.a "$TMP/install/emscripten/cache/sysroot/lib/wasm32-emscripten"/libc-*.a
    rm -rf "$TMP/install/emscripten/cache/build"/libc "$TMP/install/emscripten/cache/build"/libc-*
    echo "== install-emsdk: patch set $PATCHSET; libc rebuilds on first use" >&2
  fi
  rm -rf "$INSTALL"
  mv "$TMP/install" "$INSTALL"
  echo "$WANT" > "$STAMP"
  echo "== install-emsdk: installed $WANT → $INSTALL" >&2
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
