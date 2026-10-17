#!/usr/bin/env bash
set -euo pipefail
DEST="${1:?usage: emscripten-tree.sh <dest-dir> [<emscripten 6.0.9 tarball>]}"
TARBALL="${2:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EM_URL="https://github.com/emscripten-core/emscripten/archive/4e4223852a0835923411059a3929907d7df1232e.tar.gz"
EM_SHA="426911732c683c5940e3e089782d90d272ec2738c933e53593f9e9a65ff6aa96"
RELEASE="f04ea239d533260dd1db760dd2d668d5f9a88d6b"
BASE="https://storage.googleapis.com/webassembly/emscripten-releases-builds"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) BIN_URL="$BASE/linux/$RELEASE/wasm-binaries.tar.xz"; BIN_SHA="d5c6c2917fbc1cae1a7d1e581f1c0b2817369dd57f94c7a0d05921476f1a7287" ;;
  Darwin-arm64) BIN_URL="$BASE/mac/$RELEASE/wasm-binaries-arm64.tar.xz"; BIN_SHA="b60514308507f64f4138d3c55bdb6979f20222288700fde603dced23b65dd533" ;;
  *) echo "emscripten-tree: no emsdk $RELEASE binaries for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
fetch() {
  local url="$1" sha="$2" out="$3"
  if [[ -f "$out" ]] && echo "$sha  $out" | shasum -a 256 -c - >/dev/null 2>&1; then return 0; fi
  curl -fsSL --retry 5 --retry-all-errors --retry-delay 2 "$url" -o "$out.part"
  echo "$sha  $out.part" | shasum -a 256 -c - >&2
  mv "$out.part" "$out"
}
mkdir -p "$DEST"
if [[ -z "$TARBALL" ]]; then
  TARBALL="$DEST/emscripten-6.0.9.tar.gz"
  fetch "$EM_URL" "$EM_SHA" "$TARBALL"
else
  echo "$EM_SHA  $TARBALL" | shasum -a 256 -c - >&2
fi
EM="$DEST/emscripten"
rm -rf "$EM"
mkdir -p "$EM"
tar -xzf "$TARBALL" -C "$EM" --strip-components=1
grep -qx '6.0.9-git' "$EM/emscripten-version.txt"
for p in "$ROOT"/packages/wasm-emscripten/patches/*.patch; do
  patch -d "$EM" -p1 --batch --no-backup-if-mismatch -s < "$p"
done
if find "$EM" -name '*.rej' -o -name '*.orig' | grep -q .; then
  echo "emscripten-tree: patch leftovers in $EM" >&2
  exit 1
fi
mkdir -p "$EM/test"
(cd "$EM" && python3 tools/maint/create_entry_points.py)
rm -rf "$EM/test"
PJ="$ROOT/packages/wasm-emscripten/package/package.json"
if [[ ! -d "$DEST/node_modules/acorn" ]]; then
  npm install --prefix "$DEST" --no-save --no-package-lock --no-fund --no-audit --ignore-scripts --silent \
    "acorn@$(node -p 'require(process.argv[1]).dependencies.acorn' "$PJ")" \
    "acorn-import-phases@$(node -p 'require(process.argv[1]).dependencies["acorn-import-phases"]' "$PJ")" >&2
fi
REL="$DEST/emsdk-$RELEASE"
if [[ ! -x "$REL/install/bin/clang" || "$(cat "$REL/.sha256" 2>/dev/null)" != "$BIN_SHA" ]]; then
  fetch "$BIN_URL" "$BIN_SHA" "$DEST/emsdk-binaries.tar.xz"
  rm -rf "$REL"
  mkdir -p "$REL"
  tar -xJf "$DEST/emsdk-binaries.tar.xz" -C "$REL"
  rm -f "$DEST/emsdk-binaries.tar.xz"
  printf '%s' "$BIN_SHA" > "$REL/.sha256"
fi
test -x "$REL/install/bin/clang" && test -x "$REL/install/bin/wasm-opt"
CACHE="$DEST/cache"
mkdir -p "$CACHE/sysroot"
cat > "$DEST/config.py" <<CFG
LLVM_ROOT = '$REL/install/bin'
BINARYEN_ROOT = '$REL/install'
NODE_JS = '$(command -v node)'
CACHE = '$CACHE'
FROZEN_CACHE = False
CFG
printf 'export EMSCRIPTEN_TREE=%q\nexport EMSCRIPTEN_TREE_CONFIG=%q\nexport EMSCRIPTEN_TREE_CACHE=%q\nexport EMSDK_RELEASE_LLVM=%q\nexport EMSDK_RELEASE_BINARYEN=%q\n' \
  "$EM" "$DEST/config.py" "$CACHE" "$REL/install/bin" "$REL/install"
