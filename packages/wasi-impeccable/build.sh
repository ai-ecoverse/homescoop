#!/usr/bin/env bash
# impeccable engine for slicc — WASI preview1 file-local CLI (no Emscripten glue).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-impeccable

# GitHub archive top-level: impeccable-engine-v<version>/
SRC_DIR="$WORK/impeccable-engine-v${VERSION}"
TARBALL="$WORK/impeccable-engine-v${VERSION}.tar.gz"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
if [[ -n "${FORCE:-}" ]]; then rm -rf "$SRC_DIR"; fi
homescoop_extract "$TARBALL" "$SRC_DIR"
# HTTP verbs use crates/wasix-ureq (ureq 2's API over the kernel's sockets and
# proxy), live mode wasix-net and wasix-command; the patch depends on them at
# homescoop-crates/.
homescoop_vendor_crates "$SRC_DIR" wasix-ureq wasix-command
homescoop_apply_patches "$SRC_DIR"

# Live mode's server runs a thread per connection (SSE and the agent's
# long-poll stay open), so the engine builds for wasm32-wasip1-threads; the
# kernel runs wasi thread-spawn.
TARGET=wasm32-wasip1-threads

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
RUST="$(node "$HOMESCOOP_ROOT/scripts/read-recipe.mjs" wasi-impeccable --field toolchain.rust)"
if ! command -v rustup >/dev/null 2>&1; then
  echo "== wasi-impeccable: installing rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain none
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
fi
rustup toolchain install "$RUST" --profile minimal --target "$TARGET"
CARGO=(cargo "+$RUST")

# Panic locations name source files: map the work directory, CARGO_HOME
# (the registry crates) and the toolchain's sysroot away, so the bytes
# don't depend on where the build ran (homescoop#471). Cargo hands rustc
# physical paths (macOS: /private/tmp/…), so map that spelling too.
SYSROOT="$("${CARGO[@]/cargo/rustc}" --print sysroot)"
CARGO_DIR="${CARGO_HOME:-$HOME/.cargo}"
mkdir -p "$CARGO_DIR"
REMAP=(
  "--remap-path-prefix=$SRC_DIR=/impeccable"
  "--remap-path-prefix=$(cd "$SRC_DIR" && pwd -P)=/impeccable"
  "--remap-path-prefix=$CARGO_DIR=/cargo"
  "--remap-path-prefix=$(cd "$CARGO_DIR" && pwd -P)=/cargo"
  "--remap-path-prefix=$SYSROOT=/rustc"
)
# The cached wasm is keyed by what goes into it (toolchain, target, flags,
# the patch and the vendored crates/wasix-*), not only the upstream version,
# so a changed build reruns (homescoop#642: cargo isn't invoked on a hit, so
# its own fingerprints can't catch a crate edit).
KEY="$( { printf '%s\n' "$RUST" "$TARGET" "${REMAP[@]}"; cat "$HOMESCOOP_PKG"/*.patch; homescoop_tree_digest "$SRC_DIR/homescoop-crates"; } | shasum -a 256 | cut -c1-12)"
OUT="$WORK/wasi-impeccable-${VERSION}-$KEY"
mkdir -p "$OUT/bin"

if [[ ! -f "$OUT/bin/impeccable.wasm" || -n "${FORCE:-}" ]]; then
  echo "== wasi-impeccable: cargo build -p impeccable ($TARGET, stripped)"
  (
    cd "$SRC_DIR"
    # CARGO_ENCODED_RUSTFLAGS keeps each flag whole, spaces in paths included.
    CARGO_ENCODED_RUSTFLAGS="$(IFS=$'\x1f'; printf '%s' "${REMAP[*]}")" \
    CARGO_PROFILE_RELEASE_DEBUG=0 \
    CARGO_PROFILE_RELEASE_STRIP=true \
      "${CARGO[@]}" build --release -p impeccable --target "$TARGET"
  )
  cp "$SRC_DIR/target/$TARGET/release/impeccable.wasm" "$OUT/bin/impeccable.wasm"
fi
test -f "$OUT/bin/impeccable.wasm"

# Shrink like other wasi- Rust recipes. rustc emits bulk-memory / multivalue /
# reference-types / etc.; binaryen needs those features enabled or it rejects
# the module (bulk-memory alone is not enough for this crate).
homescoop_wasm_opt "$OUT/bin/impeccable.wasm" wasi-impeccable \
  --enable-bulk-memory --enable-multivalue --enable-reference-types \
  --enable-nontrapping-float-to-int --enable-sign-ext --enable-threads

echo "== wasi-impeccable: stage bin/impeccable.wasm"
DEST="$HOMESCOOP_PKG/package/bin"
mkdir -p "$DEST"
cp "$OUT/bin/impeccable.wasm" "$DEST/impeccable.wasm"
chmod 755 "$DEST/impeccable.wasm"

homescoop_stage_license "$SRC_DIR/LICENSE"

# Refuse host-path leaks in the wasm: home directories (CARGO_HOME's
# registry), temporary directories (the work tree), the runner's workspace.
LEAK='/Users/|/home/[^/]+/|/tmp/|/private/(tmp|var)/|/var/folders/|/rustup/'
if strings "$DEST/impeccable.wasm" | grep -E "$LEAK" >/dev/null
then
  echo "homescoop: host path leaked into impeccable.wasm" >&2
  strings "$DEST/impeccable.wasm" | grep -E "$LEAK" | head >&2
  exit 1
fi

homescoop_notices_begin "impeccable.wasm (impeccable engine $VERSION, Apache-2.0, see LICENSE; homescoop's crates/wasix-ureq and wasix-command) statically links these crates, Rust's standard library and wasi-libc."
HOMESCOOP_CARGO=CARGO homescoop_notice_rust "$SRC_DIR" "$TARGET" "$RUST" --root impeccable
echo "== wasi-impeccable: staged → $HOMESCOOP_PKG/package ($VERSION)"
