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
# homescoop#1127/#1287: pnpm.wasm's initial heap, sized from its measured
# peak (recipe.yaml wasm.initial-memory; recipe-env exports it in bytes as
# WASM_INITIAL_MEMORY). Growing shared memory while rayon workers allocate
# let V8 trap a memset into a fresh block; patches/0009's allocator refresh
# is the backstop for the growth that remains.
# HOMESCOOP_PNPM_INITIAL_MEMORY=0 builds without it (for probe runs).
PNPM_INITIAL_MEMORY="${HOMESCOOP_PNPM_INITIAL_MEMORY:-${WASM_INITIAL_MEMORY:?recipe.yaml wasm.initial-memory}}"
if [[ "$PNPM_INITIAL_MEMORY" != 0 ]]; then
  CARGO_ENCODED_RUSTFLAGS="$CARGO_ENCODED_RUSTFLAGS$(printf '\x1f%s' "-Clink-arg=--initial-memory=$PNPM_INITIAL_MEMORY")"
fi
export CARGO_ENCODED_RUSTFLAGS
# The C the crates compile (tree-sitter's assert()s) names its sources by
# __FILE__: map CARGO_HOME and the tree there too. cc adds TARGET_CFLAGS to
# the CFLAGS_<target> that pnpm/wasm/build.mjs sets.
export TARGET_CFLAGS="-ffile-prefix-map=$CARGO_HOME_DIR=/cargo -ffile-prefix-map=$(cd "$CARGO_HOME_DIR" && pwd -P)=/cargo -ffile-prefix-map=$SRC=/pnpm -ffile-prefix-map=$(cd "$SRC" && pwd -P)=/pnpm"
# Link with the name section but without the DWARF std ships
# (strip=debuginfo instead of pnpm's strip=symbols; debug stays false) and
# keep that module (patches/0003). names.py moves its Rust function names,
# renumbered past the two imports build.mjs adds, into bin/pnpm.wasm.names
# (beside pnpm.wasm), and drops the generated-only name section build.mjs's
# wat2wasm --debug-names writes, so SLICC names a trap's frames under
# SLICC_WASM_BACKTRACE=1. The other strip setting re-links the code: since
# 12.9.1-10 the code isn't 12.9.1-9's (homescoop#1126), and names from one
# build don't fit another.
export CARGO_PROFILE_RELEASE_STRIP=debuginfo
LINKED="$WORK/pnpm.linked.wasm"
NAMES_OUT="$WORK/pnpm.wasm.names"
rm -f "$LINKED" "$NAMES_OUT"
export PNPM_WASM_LINKED="$LINKED"
(cd "$SRC" && node pnpm/wasm/build.mjs)

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
python3 "$HOMESCOOP_PKG/names.py" "$LINKED" "$SRC/target/wasm32-wasip1-threads/release/pnpm.wasm" \
  "$DEST/bin/pnpm.wasm" "$NAMES_OUT"
chmod 755 "$DEST/bin/pnpm.wasm"
# Beside pnpm.wasm, where SLICC looks first for a module without a name
# section under SLICC_WASM_BACKTRACE=1 (5.9 MB, 0.8 MB gzipped).
cp "$NAMES_OUT" "$DEST/bin/pnpm.wasm.names"
cp "$SRC/LICENSE" "$DEST/LICENSE"
# homescoop#1325: upstream's notices (Yarn), then those of everything
# pnpm.wasm links: the crates (cargo metadata/tree of pnpm-cli for the
# target), Rust's standard library and its self-contained wasi-libc. The
# toolchain is a nightly, so homescoop_notice_rust's release table doesn't
# apply: its commit and licence sha256s are pinned here (the licence files
# are byte-identical to 1.98.1's; the libc is wasi-sdk-34's, per the
# commit's dist-various-2 Dockerfile, checked below).
RUST_COMMIT=bff8e12ff5e6bcd53dfb1dbccdcec80a60a856ed
[[ "$RUST" == nightly-2026-08-27 ]] || { echo "homescoop: pin the Rust commit and licence sha256s for $RUST" >&2; exit 1; }
# Not grep -q on a pipe: under pipefail its early exit fails rustc with SIGPIPE.
RUST_VV="$(rustc "+$RUST" -vV)"
[[ "$RUST_VV" == *$'\n'"commit-hash: $RUST_COMMIT"$'\n'* ]] || { echo "homescoop: $RUST is not commit $RUST_COMMIT:" >&2; echo "$RUST_VV" >&2; exit 1; }
HOMESCOOP_NOTICES="$DEST/THIRD-PARTY-NOTICES.md"
mkdir -p "$WORK/notices"
cp "$SRC/pnpm/npm/pnpm/THIRD-PARTY-NOTICES.md" "$HOMESCOOP_NOTICES"
printf '\n# Linked into bin/pnpm.wasm\n\nbin/pnpm.wasm (pnpm, MIT, see LICENSE, with homescoop'"'"'s patches) statically links these crates, Rust'"'"'s standard library and wasi-libc.\n' >>"$HOMESCOOP_NOTICES"
(cd "$SRC" && cargo "+$RUST" metadata --locked --format-version 1 --filter-platform wasm32-wasip1-threads) >"$WORK/rust-notices-metadata.json"
(cd "$SRC" && cargo "+$RUST" tree --locked --target wasm32-wasip1-threads -e normal,no-proc-macro --prefix none -p pnpm-cli) >"$WORK/rust-notices-tree.txt"
node "$ROOT/scripts/rust-crate-notices.mjs" "$WORK/rust-notices-metadata.json" "$WORK/rust-notices-tree.txt" >>"$HOMESCOOP_NOTICES"
node "$ROOT/scripts/check-rust-notices.mjs" "$HOMESCOOP_NOTICES" "$WORK/rust-notices-tree.txt" "$SRC/Cargo.lock"
node "$ROOT/scripts/check-rust-wasi-sdk.mjs" "$RUST_COMMIT" wasi-sdk-34
RL="https://raw.githubusercontent.com/rust-lang/rust/$RUST_COMMIT"
homescoop_notice "Rust standard library ($RUST, commit $RUST_COMMIT; MIT OR Apache-2.0)" \
  "$RL/COPYRIGHT" 172020dbfd5b53a226dfde77616190a48dcff519b0bc0e6deb91a8450782c4af \
  "$RL/LICENSE-MIT" b71bd43a069ca0641a9ecfe585ca7b3c53b5cc1608f8b68321168698e28b5ea1 \
  "$RL/LICENSE-APACHE" 62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a
WL=https://raw.githubusercontent.com/WebAssembly/wasi-libc/wasi-sdk-34
homescoop_notice "wasi-libc (wasi-sdk-34; Rust's self-contained wasm32-wasip1-threads libc)" \
  "$WL/LICENSE" 2711a8b5a5cdfef0e639f96c1aca12ae23d7d64a02d0507f1bdf14d2b27bbc3a \
  "$WL/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WL/libc-top-half/musl/COPYRIGHT" b870108ec5e7790e9f9919064f1b9421d62d5f9b0e6c230c6adf7ea2da62e97b \
  "$WL/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0
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
if strings "$NAMES_OUT" | grep -E "$LEAK" >/dev/null; then
  echo "homescoop: a build path leaked into pnpm.wasm.names" >&2
  exit 1
fi
if [[ "$PNPM_INITIAL_MEMORY" != 0 ]]; then
  node -e '
    const b = require("fs").readFileSync(process.argv[1]);
    const mem = WebAssembly.Module.imports(new WebAssembly.Module(b)).find((i) => i.kind === "memory");
    // The import section entry: env.memory, flags, min pages.
    const at = b.indexOf(Buffer.from("\x03env\x06memory\x02"));
    let p = at + 12, v = 0, s = 0, x;
    const flags = b[p++];
    do { x = b[p++]; v |= (x & 127) << s; s += 7; } while (x & 128);
    if (!mem || at < 0 || v * 65536 !== Number(process.argv[2])) { console.error(`pnpm.wasm imports memory with ${v} pages, not ${process.argv[2]} bytes`); process.exit(1); }
    console.log(`pnpm.wasm: initial memory ${v} pages (${v / 16} MiB), flags ${flags}`);
  ' "$DEST/bin/pnpm.wasm" "$PNPM_INITIAL_MEMORY"
fi
shasum -a 256 "$DEST/bin/pnpm.wasm" "$NAMES_OUT"
echo "OK wasi-pnpm $VERSION (pnpm $COMMIT + patches)"
