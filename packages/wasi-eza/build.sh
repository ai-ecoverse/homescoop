#!/usr/bin/env bash
# eza for slicc WASI preview1 (wasm32-wasip1), no Emscripten glue.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-eza

TARGET=wasm32-wasip1
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
RUST="$(node "$HOMESCOOP_ROOT/scripts/read-recipe.mjs" wasi-eza --field toolchain.rust)"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
fi
rustup toolchain install "$RUST" --profile minimal --target "$TARGET"
CARGO=(cargo "+$RUST")

TB="$WORK/eza-${VERSION}.crate"
SRC="$WORK/eza-${VERSION}"
VENDOR="$WORK/eza-${VERSION}-vendor"
TARGET_DIR="$WORK/wasi-eza-target"
OUT="$WORK/wasi-eza-${VERSION}"

echo "== wasi-eza: eza@${VERSION} from the .crate, deps vendored (--locked)"
rm -rf "$SRC" "$VENDOR" "$OUT"
mkdir -p "$OUT"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
tar xzf "$TB" -C "$WORK"
homescoop_apply_patches "$SRC"
(cd "$SRC" && "${CARGO[@]}" vendor --quiet --locked --versioned-dirs "$VENDOR" >/dev/null)
VENDORED=(--config 'source.crates-io.replace-with="vendored-sources"'
  --config "source.vendored-sources.directory=\"$VENDOR\"")

echo "== wasi-eza: cargo build ($TARGET, Rust $RUST, no default features)"
SYSROOT="$(rustc "+$RUST" --print sysroot)"
# Upstream's release profile (lto, one codegen unit, panic=abort). Strip
# only debuginfo: the target_features section tells wasm-opt what rustc
# enabled. Panic locations name source files: map the build machine away.
(cd "$SRC" && CARGO_TARGET_DIR="$TARGET_DIR" \
  CARGO_PROFILE_RELEASE_DEBUG=false \
  CARGO_PROFILE_RELEASE_STRIP=debuginfo \
  CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS="--remap-path-prefix=$SRC=/eza --remap-path-prefix=$VENDOR=/vendor --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo --remap-path-prefix=$SYSROOT=/rustc --remap-path-prefix=$HOME=/home" \
  "${CARGO[@]}" build --release --locked --offline --no-default-features --bin eza --target "$TARGET" "${VENDORED[@]}")
cp "$TARGET_DIR/$TARGET/release/eza.wasm" "$OUT/eza.wasm"

FEATURES=()
read -r -a FEATURES <<<"$(node -e '
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
  console.log(out.join(" "));' "$OUT/eza.wasm")"
[[ ${#FEATURES[@]} -gt 0 ]] || { echo "wasi-eza: no target_features section in eza.wasm" >&2; exit 1; }
homescoop_wasm_opt "$OUT/eza.wasm" wasi-eza "${FEATURES[@]}" --strip-producers --strip-target-features

# A command, importing only WASI preview1 and the slicc-kernel calls the
# patch uses (each answers ENOSYS on a kernel without it).
node -e '
  const m = new WebAssembly.Module(require("fs").readFileSync(process.argv[1]));
  const ok = new Set(["slicc_fs.path_filestat_owner", "slicc_fs.path_mode", "slicc.cred_get", "slicc_tty.winsize"]);
  const bad = WebAssembly.Module.imports(m).filter((i) => i.module !== "wasi_snapshot_preview1" && !ok.has(i.module + "." + i.name));
  if (bad.length) { console.error("wasi-eza: unexpected imports " + bad.map((i) => i.module + "." + i.name).join(" ")); process.exit(1); }
  if (!WebAssembly.Module.exports(m).some((e) => e.name === "_start")) { console.error("wasi-eza: no _start export"); process.exit(1); }' "$OUT/eza.wasm"
for prefix in "$SRC" "$VENDOR" "$WORK" "$HOME" "${CARGO_HOME:-$HOME/.cargo}" "$SYSROOT"; do
  if grep -qaF "$prefix" "$OUT/eza.wasm"; then
    echo "homescoop: host path $prefix leaked into eza.wasm" >&2
    exit 1
  fi
done

echo "== wasi-eza: stage bin/eza.wasm"
DEST="$HOMESCOOP_PKG/package/bin"
mkdir -p "$DEST"
cp "$OUT/eza.wasm" "$DEST/eza.wasm"
chmod 755 "$DEST/eza.wasm"

# eza is EUPL-1.2; the exa code it grew from (and most files) is MIT too.
grep -q 'EUROPEAN UNION PUBLIC LICENCE v. 1.2' "$SRC/LICENSE.txt"
grep -q 'MIT License' "$SRC/LICENSES/MIT.txt"
{
  echo "eza is licensed under EUPL-1.2 AND MIT (see REUSE.toml and each file's"
  echo "SPDX headers in the eza ${VERSION} crate)."
  echo
  echo "----- LICENSE.txt (EUPL-1.2) -----"
  cat "$SRC/LICENSE.txt"
  echo
  echo "----- LICENSES/MIT.txt -----"
  cat "$SRC/LICENSES/MIT.txt"
} >"$HOMESCOOP_PKG/package/LICENSE"

homescoop_notices_begin "eza.wasm (eza $VERSION, EUPL-1.2 AND MIT, see LICENSE) statically links these crates, Rust's standard library and wasi-libc."
(cd "$SRC" && HOMESCOOP_CARGO=CARGO homescoop_notice_rust "$SRC" "$TARGET" "$RUST" --root eza -- --offline --no-default-features "${VENDORED[@]}")
shasum -a 256 "$DEST/eza.wasm"
echo "OK wasi-eza $VERSION (eza)"
