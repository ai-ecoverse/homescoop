#!/usr/bin/env bash
# pnpm 12 for slicc WASI: build pnpm.wasm from pnpm's source with upstream's
# pnpm/wasm/build.mjs, the pinned toolchain and the patches in patches/.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-pnpm
field () { node "$ROOT/scripts/read-recipe.mjs" wasi-pnpm --field "$1"; }

COMMIT="$(field source.commit)"
RUST="$(field toolchain.rust)"
SDK_VERSION="$(field toolchain.wasi_sdk)"
WABT_VERSION="$(field toolchain.wabt)"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) sdk_arch=x86_64-linux; wabt_arch=linux-x64; host=linux_x64 ;;
  Darwin-arm64) sdk_arch=arm64-macos; wabt_arch=macos-arm64; host=macos_arm64 ;;
  *) echo "homescoop: no wasi-pnpm toolchain pin for $(uname -sm)" >&2; exit 1 ;;
esac

TOOLS="$WORK/wasi-pnpm-tools"
mkdir -p "$TOOLS"
SDK_TGZ="$TOOLS/wasi-sdk-$SDK_VERSION-$sdk_arch.tar.gz"
homescoop_fetch "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${SDK_VERSION%%.*}/wasi-sdk-$SDK_VERSION-$sdk_arch.tar.gz" \
  "$(field "toolchain.wasi_sdk_sha256_$host")" "$SDK_TGZ"
WABT_TGZ="$TOOLS/wabt-$WABT_VERSION-$wabt_arch.tar.gz"
homescoop_fetch "https://github.com/WebAssembly/wabt/releases/download/$WABT_VERSION/wabt-$WABT_VERSION-$wabt_arch.tar.gz" \
  "$(field "toolchain.wabt_sha256_$host")" "$WABT_TGZ"
[[ -d "$TOOLS/wasi-sdk-$SDK_VERSION-$sdk_arch" ]] || tar -xzf "$SDK_TGZ" -C "$TOOLS"
[[ -d "$TOOLS/wabt-$WABT_VERSION" ]] || tar -xzf "$WABT_TGZ" -C "$TOOLS"
export WASI_SDK_PATH="$TOOLS/wasi-sdk-$SDK_VERSION-$sdk_arch"
export WABT_PATH="$TOOLS/wabt-$WABT_VERSION"

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
rustup toolchain install "$RUST" --profile minimal --target wasm32-wasip1-threads

SRC_TGZ="$WORK/pnpm-$COMMIT.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRC_TGZ"
SRC="$WORK/pnpm-$COMMIT"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$SRC_TGZ" -C "$SRC" --strip-components=1
for p in "$HOMESCOOP_PKG"/patches/*.patch; do
  echo "== patch $(basename "$p")"
  patch -p1 -d "$SRC" < "$p"
done
python3 - "$SRC/.cargo/config.toml" <<'PY'
import sys
path = sys.argv[1]
text = open(path).read()
start = text.index('# >>> pnpm-managed cargo sources >>>')
end = text.index('# <<< pnpm-managed cargo sources <<<\n') + len('# <<< pnpm-managed cargo sources <<<\n')
open(path, 'w').write(text[:start] + text[end:])
PY

CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
CARGO_ENCODED_RUSTFLAGS="$(printf '%s\x1f%s' "--remap-path-prefix=$SRC=/pnpm" "--remap-path-prefix=$CARGO_HOME_DIR=/cargo")"
export CARGO_ENCODED_RUSTFLAGS
(cd "$SRC" && node pnpm/wasm/build.mjs)

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
cp "$SRC/target/wasm32-wasip1-threads/release/pnpm.wasm" "$DEST/bin/pnpm.wasm"
chmod 755 "$DEST/bin/pnpm.wasm"
cp "$SRC/LICENSE" "$DEST/LICENSE"
cp "$SRC/pnpm/npm/pnpm/THIRD-PARTY-NOTICES.md" "$DEST/THIRD-PARTY-NOTICES.md"
if strings "$DEST/bin/pnpm.wasm" | grep -q 'Parking not supported on this platform'; then
  echo "homescoop: pnpm.wasm still contains parking_lot's panicking wasm parker" >&2
  exit 1
fi
shasum -a 256 "$DEST/bin/pnpm.wasm"
echo "OK wasi-pnpm $VERSION (pnpm $COMMIT + patches)"
