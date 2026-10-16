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
# Cargo hands rustc physical paths (macOS: /private/tmp/…): map those too.
CARGO_ENCODED_RUSTFLAGS="$(printf '%s\x1f%s\x1f%s' "--remap-path-prefix=$SRC=/pnpm" "--remap-path-prefix=$(cd "$SRC" && pwd -P)=/pnpm" "--remap-path-prefix=$CARGO_HOME_DIR=/cargo")"
export CARGO_ENCODED_RUSTFLAGS
# The C the crates compile (tree-sitter's assert()s) names its sources by
# __FILE__: map CARGO_HOME and the tree there too. cc adds TARGET_CFLAGS to
# the CFLAGS_<target> that pnpm/wasm/build.mjs sets.
export TARGET_CFLAGS="-ffile-prefix-map=$CARGO_HOME_DIR=/cargo -ffile-prefix-map=$(cd "$CARGO_HOME_DIR" && pwd -P)=/cargo -ffile-prefix-map=$SRC=/pnpm -ffile-prefix-map=$(cd "$SRC" && pwd -P)=/pnpm"
(cd "$SRC" && node pnpm/wasm/build.mjs)

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
cp "$SRC/target/wasm32-wasip1-threads/release/pnpm.wasm" "$DEST/bin/pnpm.wasm"
chmod 755 "$DEST/bin/pnpm.wasm"
cp "$SRC/LICENSE" "$DEST/LICENSE"
cp "$SRC/pnpm/npm/pnpm/THIRD-PARTY-NOTICES.md" "$DEST/THIRD-PARTY-NOTICES.md"
# Not grep -q: under pipefail its early exit fails strings with SIGPIPE, and
# the pipeline then reads as no match (this check passed a build without 0001).
if strings "$DEST/bin/pnpm.wasm" | grep 'Parking not supported on this platform' >/dev/null; then
  echo "homescoop: pnpm.wasm still contains parking_lot's panicking wasm parker" >&2
  exit 1
fi
# No build path in the bytes (homescoop#522): the work tree, CARGO_HOME, a
# home or temp directory. 0002 drops the one env!("CARGO_MANIFEST_DIR"),
# TARGET_CFLAGS the C sources' __FILE__.
LEAK="$WORK|$SRC|$CARGO_HOME_DIR|/home/runner|/tmp/homescoop-work|/Users/|/private/(tmp|var)/|/var/folders/"
if strings "$DEST/bin/pnpm.wasm" | grep -E "$LEAK" >/dev/null; then
  echo "homescoop: a build path leaked into pnpm.wasm" >&2
  strings "$DEST/bin/pnpm.wasm" | grep -E "$LEAK" | head >&2
  exit 1
fi
shasum -a 256 "$DEST/bin/pnpm.wasm"
echo "OK wasi-pnpm $VERSION (pnpm $COMMIT + patches)"
