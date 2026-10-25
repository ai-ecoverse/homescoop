#!/usr/bin/env bash
# bat for slicc — WASI preview1 (wasm32-wasip1), no Emscripten glue
# (recipe.yaml notes).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-bat
field() { node "$HOMESCOOP_ROOT/scripts/read-recipe.mjs" wasi-bat --field "$1"; }

TARGET=wasm32-wasip1
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
RUST="$(field toolchain.rust)"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
fi
rustup toolchain install "$RUST" --profile minimal --target "$TARGET"
CARGO=(cargo "+$RUST")

# wasi-sdk for onig_sys's C (Oniguruma), pinned in the recipe as wasi-llvm does.
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) sdk_host=linux_x64 ;;
  Darwin-arm64) sdk_host=macos_arm64 ;;
  *) echo "wasi-bat: no wasi-sdk pin for $(uname -sm)" >&2; exit 1 ;;
esac
HOMESCOOP_WASI_SDK_VERSION="$(field toolchain.wasi-sdk)"
HOMESCOOP_WASI_SDK_SHA="$(field "toolchain.wasi_sdk_sha256_$sdk_host")"
export HOMESCOOP_WASI_SDK_VERSION HOMESCOOP_WASI_SDK_SHA
eval "$(bash "$ROOT/scripts/install-wasi-sdk.sh" "$WORK/$(bash "$ROOT/scripts/install-wasi-sdk.sh" --name)")"
SDK="$WASI_SDK_PATH"

OUT="$WORK/wasi-bat-${VERSION}"
SRC="$WORK/bat-${VERSION}"
VENDOR="$WORK/bat-${VERSION}-vendor"
TARGET_DIR="$WORK/wasi-bat-target"
CRATE="$WORK/bat-${VERSION}.crate"

echo "== wasi-bat: bat@${VERSION} from the .crate, deps vendored (--locked)"
rm -rf "$OUT" "$SRC" "$VENDOR" "$TARGET_DIR"
mkdir -p "$OUT"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$CRATE"
tar xzf "$CRATE" -C "$WORK"
test -f "$SRC/Cargo.lock"
echo "== patch bat-wasi-no-builtin-pager.patch → bat-${VERSION}"
patch -d "$SRC" -p1 --no-backup-if-mismatch < "$HOMESCOOP_PKG/patches/bat-wasi-no-builtin-pager.patch"
(cd "$SRC" && "${CARGO[@]}" vendor --locked --versioned-dirs "$VENDOR" >/dev/null)
# patches/<crate>-*.patch apply to that vendored crate; an empty "files" map
# makes cargo skip per-file checksums for it only.
for crate in clircle console etcetera; do
  dir="$(cd "$VENDOR" && ls -d "$crate"-[0-9]*)"
  for p in "$HOMESCOOP_PKG/patches/$crate"-*.patch; do
    echo "== patch $(basename "$p") → $dir"
    patch -d "$VENDOR/$dir" -p1 --no-backup-if-mismatch < "$p"
  done
  node -e 'const f=process.argv[1];const fs=require("fs");const j=JSON.parse(fs.readFileSync(f));j.files={};fs.writeFileSync(f,JSON.stringify(j))' \
    "$VENDOR/$dir/.cargo-checksum.json"
done
# Upstream's default features without git (libgit2).
FEATURES=(--no-default-features --features application)
VENDORED=(--offline
  --config 'source.crates-io.replace-with="vendored-sources"'
  --config "source.vendored-sources.directory=\"$VENDOR\"")

echo "== wasi-bat: cargo build ($TARGET, Rust $RUST)"
SYSROOT="$(rustc "+$RUST" --print sysroot)"
export CC_wasm32_wasip1="$SDK/bin/clang" AR_wasm32_wasip1="$SDK/bin/llvm-ar"
export CFLAGS_wasm32_wasip1="--target=$TARGET --sysroot=$SDK/share/wasi-sysroot -ffile-prefix-map=$VENDOR=/vendor -ffile-prefix-map=$SDK=/wasi-sdk"
# Upstream's release profile (lto, codegen-units 1), stripping only debuginfo
# so the target_features section reaches wasm-opt. path_abs and the
# patched clircle need std::os::wasi (wasi_ext), for those two crates only.
# GIT_CEILING_DIRECTORIES: git-version (in bat --version) must not find the
# checkout WORK sits in. Panic locations name source files: map them away
# (rustc applies the last matching prefix, so the most specific comes last).
(cd "$SRC" && CARGO_TARGET_DIR="$TARGET_DIR" \
  RUSTC_BOOTSTRAP=path_abs,clircle \
  GIT_CEILING_DIRECTORIES="$WORK" \
  CARGO_PROFILE_RELEASE_DEBUG=false \
  CARGO_PROFILE_RELEASE_STRIP=debuginfo \
  CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS="--remap-path-prefix=$HOME=/home --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$SYSROOT=/rustc --remap-path-prefix=$WORK=/work --remap-path-prefix=$SRC=/bat --remap-path-prefix=$VENDOR=/vendor" \
  "${CARGO[@]}" build --release --locked --target "$TARGET" \
    "${FEATURES[@]}" "${VENDORED[@]}")
WASM="$TARGET_DIR/$TARGET/release/bat.wasm"
test -f "$WASM"
cp "$WASM" "$OUT/bat.wasm"

# The features rustc enabled (its target_features section), as wasi-tsrs
# passes them to wasm-opt.
WASM_FEATURES=()
read -r -a WASM_FEATURES <<<"$(node -e '
  const m = new WebAssembly.Module(require("fs").readFileSync(process.argv[1]));
  const s = WebAssembly.Module.customSections(m, "target_features")[0];
  const out = [];
  if (s) {
    const b = new Uint8Array(s); let i = 0;
    const leb = () => { let r = 0, sh = 0, x; do { x = b[i++]; r |= (x & 127) << sh; sh += 7; } while (x & 128); return r; };
    for (let n = leb(), k = 0; k < n; k++) {
      const prefix = String.fromCharCode(b[i++]); const len = leb();
      const name = new TextDecoder().decode(b.subarray(i, i + len)); i += len;
      if (prefix === "+") out.push("--enable-" + (name === "nontrapping-fptoint" ? "nontrapping-float-to-int" : name));
    }
  }
  console.log(out.join(" "));' "$OUT/bat.wasm")"
[[ ${#WASM_FEATURES[@]} -gt 0 ]] || { echo "wasi-bat: no target_features section in bat.wasm" >&2; exit 1; }
homescoop_wasm_opt "$OUT/bat.wasm" wasi-bat "${WASM_FEATURES[@]}" --strip-producers --strip-target-features

# A command, with only WASI preview1 imports and slicc_tty.winsize (the
# console patch).
node -e '
  const m = new WebAssembly.Module(require("fs").readFileSync(process.argv[1]));
  const imports = WebAssembly.Module.imports(m);
  const bad = imports.filter((i) => i.module !== "wasi_snapshot_preview1" && !(i.module === "slicc_tty" && i.name === "winsize"));
  if (!imports.some((i) => i.module === "slicc_tty" && i.name === "winsize")) { console.error("wasi-bat: no slicc_tty.winsize import (patches/console-wasi-winsize.patch)"); process.exit(1); }
  if (bad.length) { console.error("wasi-bat: unexpected imports " + bad.map((i) => i.module + "." + i.name).join(" ")); process.exit(1); }
  if (!WebAssembly.Module.exports(m).some((e) => e.name === "_start")) { console.error("wasi-bat: no _start export"); process.exit(1); }' "$OUT/bat.wasm"
for prefix in "$SRC" "$VENDOR" "$WORK" "$HOME" "${CARGO_HOME:-$HOME/.cargo}" "$SYSROOT" "$SDK" "bat-${VERSION}-vendor"; do
  if grep -qaF "$prefix" "$OUT/bat.wasm"; then
    echo "homescoop: host path $prefix leaked into bat.wasm" >&2
    exit 1
  fi
done

echo "== wasi-bat: stage bin/bat.wasm"
DEST="$HOMESCOOP_PKG/package/bin"
mkdir -p "$DEST"
cp "$OUT/bat.wasm" "$DEST/bat.wasm"
chmod 755 "$DEST/bat.wasm"
for f in LICENSE-MIT LICENSE-APACHE NOTICE; do
  test -s "$SRC/$f" || { echo "wasi-bat: no $f in bat-${VERSION}.crate" >&2; exit 1; }
done
{
  echo "bat is dual-licensed under MIT OR Apache-2.0."
  echo
  echo "----- LICENSE-MIT -----"
  cat "$SRC/LICENSE-MIT"
  echo
  echo "----- LICENSE-APACHE -----"
  cat "$SRC/LICENSE-APACHE"
} > "$HOMESCOOP_PKG/package/LICENSE"
cp "$SRC/NOTICE" "$HOMESCOOP_PKG/package/NOTICE"

# bat --acknowledgements: the licences of the syntaxes and themes compiled
# into assets/*.bin (bincode String: u64 length, then UTF-8, zlib-compressed).
ACK="$WORK/notices/bat-acknowledgements.txt"
mkdir -p "$WORK/notices"
node -e '
  const fs = require("fs"), zlib = require("zlib");
  const b = zlib.inflateSync(fs.readFileSync(process.argv[1]));
  const n = Number(b.readBigUInt64LE(0));
  if (n !== b.length - 8) { console.error("wasi-bat: acknowledgements.bin is not one bincode String"); process.exit(1); }
  fs.writeFileSync(process.argv[2], b.subarray(8).toString("utf8"));' "$SRC/assets/acknowledgements.bin" "$ACK"
grep -q '^## syntaxes/' "$ACK" && grep -q '^## themes/' "$ACK" \
  || { echo "wasi-bat: unexpected acknowledgements text" >&2; exit 1; }
ONIG="$(cd "$VENDOR" && ls -d onig_sys-[0-9]*)"
grep -q 'K.Kosako' "$VENDOR/$ONIG/oniguruma/COPYING" \
  || { echo "wasi-bat: unexpected Oniguruma COPYING" >&2; exit 1; }

homescoop_notices_begin "bat.wasm (bat $VERSION, MIT OR Apache-2.0, see LICENSE and NOTICE, with homescoop's patches) statically links these crates, Oniguruma (bundled in onig_sys), Rust's standard library and wasi-libc, and bat's syntaxes and themes. clircle, console and etcetera are the crates.io releases named, with homescoop's patches (packages/wasi-bat/patches/)."
(cd "$SRC" && CARGO_TARGET_DIR="$TARGET_DIR" HOMESCOOP_CARGO=CARGO homescoop_notice_rust "$SRC" "$TARGET" "$RUST" -- "${FEATURES[@]}" "${VENDORED[@]}")
homescoop_notice "Oniguruma $(sed -n 's/^#define ONIGURUMA_VERSION_MAJOR *//p' "$VENDOR/$ONIG/oniguruma/src/oniguruma.h").$(sed -n 's/^#define ONIGURUMA_VERSION_MINOR *//p' "$VENDOR/$ONIG/oniguruma/src/oniguruma.h").$(sed -n 's/^#define ONIGURUMA_VERSION_TEENY *//p' "$VENDOR/$ONIG/oniguruma/src/oniguruma.h") (BSD-2-Clause; bundled in $ONIG, oniguruma/COPYING)" \
  "$VENDOR/$ONIG/oniguruma/COPYING" -
homescoop_notice "bat's syntaxes and themes (assets/acknowledgements.bin; bat --acknowledgements)" "$ACK" -
shasum -a 256 "$DEST/bat.wasm"
echo "OK wasi-bat $VERSION (bat)"
