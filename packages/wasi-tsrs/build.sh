#!/usr/bin/env bash
# tsrs for slicc WASI (wasm32-wasip1), no Emscripten glue: native tsrs's tsc
# driver over std::fs as the command tsrs (recipe.yaml notes).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-tsrs

TARGET=wasm32-wasip1
export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
RUST="$(node "$HOMESCOOP_ROOT/scripts/read-recipe.mjs" wasi-tsrs --field toolchain.rust)"
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain none
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
fi
rustup toolchain install "$RUST" --profile minimal --target "$TARGET"
CARGO=(cargo "+$RUST")

TARBALL="$WORK/tsrs-${VERSION}.tar.gz"
SRC="$WORK/tsrs-${VERSION}"
OUT="$WORK/wasi-tsrs-${VERSION}"
TARGET_DIR="$WORK/wasi-tsrs-target"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
rm -rf "$SRC" "$OUT"
mkdir -p "$SRC" "$OUT"
tar -xzf "$TARBALL" -C "$SRC" --strip-components=1
grep -qx "channel = \"$RUST\"" "$SRC/rust-toolchain.toml" \
  || { echo "wasi-tsrs: toolchain.rust $RUST is not tsrs $VERSION's rust-toolchain.toml channel" >&2; exit 1; }

# Our command crate joins the workspace (members = crates/*). Cargo.lock must
# gain exactly its package entry and nothing else.
cp -R "$HOMESCOOP_PKG/tsrs_wasi" "$SRC/crates/tsrs_wasi"
cp "$SRC/Cargo.lock" "$OUT/Cargo.lock.upstream"
(cd "$SRC" && "${CARGO[@]}" update --workspace)
node -e '
  const fs = require("fs");
  const blocks = (f) => fs.readFileSync(f, "utf8").split(/\n(?=\[\[package\]\])/).map((b) => b.trim());
  const before = new Set(blocks(process.argv[1])), after = blocks(process.argv[2]);
  const added = after.filter((b) => !before.has(b));
  const gone = [...before].filter((b) => !after.includes(b));
  if (gone.length || added.length !== 1 || !/^\[\[package\]\]\nname = "tsrs_wasi"\n/.test(added[0])) {
    console.error("wasi-tsrs: adding crates/tsrs_wasi changed Cargo.lock beyond its own entry:\n" + [...gone.map((b) => "- " + b), ...added.map((b) => "+ " + b)].join("\n"));
    process.exit(1);
  }' "$OUT/Cargo.lock.upstream" "$SRC/Cargo.lock"

echo "== wasi-tsrs: cargo build -p tsrs_wasi ($TARGET, Rust $RUST)"
SYSROOT="$(rustc "+$RUST" --print sysroot)"
# Upstream's module settings (tools/wasm/build.sh, OPT=s), scoped to this
# command; the 80 MiB shadow stack is upstream's measured rule. Panic
# locations name source files: map the build machine's paths away.
(cd "$SRC" && CARGO_TARGET_DIR="$TARGET_DIR" \
  CARGO_PROFILE_RELEASE_OPT_LEVEL=s \
  CARGO_PROFILE_RELEASE_LTO=fat \
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 \
  CARGO_PROFILE_RELEASE_PANIC=abort \
  CARGO_PROFILE_RELEASE_DEBUG=false \
  CARGO_PROFILE_RELEASE_STRIP=debuginfo \
  CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS="-C llvm-args=-inlinehint-threshold=150 -C link-arg=-zstack-size=83886080 --remap-path-prefix=$SRC=/tsrs --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}/registry/src=/cargo --remap-path-prefix=$SYSROOT/lib/rustlib/src/rust=/rustc --remap-path-prefix=$HOME=/home" \
  "${CARGO[@]}" build --release --locked -p tsrs_wasi --target "$TARGET")
WASM="$TARGET_DIR/$TARGET/release/tsrs.wasm"
test -f "$WASM"
cp "$WASM" "$OUT/tsrs.wasm"

# The features rustc enabled (its target_features section, kept by stripping
# only debuginfo above), as upstream's build passes them to wasm-opt.
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
  console.log(out.join(" "));' "$OUT/tsrs.wasm")"
[[ ${#FEATURES[@]} -gt 0 ]] || { echo "wasi-tsrs: no target_features section in tsrs.wasm" >&2; exit 1; }
homescoop_wasm_opt "$OUT/tsrs.wasm" wasi-tsrs "${FEATURES[@]}" --strip-producers --strip-target-features

# A command, with only WASI preview1 imports: no tsrs_host, no thread-spawn.
node -e '
  const m = new WebAssembly.Module(require("fs").readFileSync(process.argv[1]));
  const bad = WebAssembly.Module.imports(m).filter((i) => i.module !== "wasi_snapshot_preview1");
  if (bad.length) { console.error("wasi-tsrs: unexpected imports " + bad.map((i) => i.module + "." + i.name).join(" ")); process.exit(1); }
  if (!WebAssembly.Module.exports(m).some((e) => e.name === "_start")) { console.error("wasi-tsrs: no _start export"); process.exit(1); }' "$OUT/tsrs.wasm"
for prefix in "$SRC" "$WORK" "$HOME" "${CARGO_HOME:-$HOME/.cargo}" "$SYSROOT"; do
  if grep -qaF "$prefix" "$OUT/tsrs.wasm"; then
    echo "homescoop: host path $prefix leaked into tsrs.wasm" >&2
    exit 1
  fi
done

echo "== wasi-tsrs: stage bin/tsrs.wasm"
DEST="$HOMESCOOP_PKG/package/bin"
mkdir -p "$DEST"
cp "$OUT/tsrs.wasm" "$DEST/tsrs.wasm"
chmod 755 "$DEST/tsrs.wasm"
cp "$SRC/LICENSE" "$HOMESCOOP_PKG/package/LICENSE"
cp "$SRC/NOTICE" "$HOMESCOOP_PKG/package/NOTICE"

homescoop_notices_begin "tsrs.wasm (tsrs $VERSION, Apache-2.0, see LICENSE and NOTICE) statically links these crates, Rust's standard library and wasi-libc."
(cd "$SRC" && CARGO_TARGET_DIR="$TARGET_DIR" HOMESCOOP_CARGO=CARGO homescoop_notice_rust "$SRC" "$TARGET" "$RUST" --root tsrs_wasi)
shasum -a 256 "$DEST/tsrs.wasm"
echo "OK wasi-tsrs $VERSION (tsrs)"
