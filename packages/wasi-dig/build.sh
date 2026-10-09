#!/usr/bin/env bash
# wasi-dig: build the in-tree dig command (src/) for wasm32-wasip1
# with homescoop's crates/wasix-net vendored next to it, and stage
# bin/dig.wasm plus THIRD-PARTY-NOTICES.md.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
# No upstream source, so not homescoop_load_recipe (it requires source.url).
HOMESCOOP_PKG="$ROOT/packages/wasi-dig"
field() { node "$ROOT/scripts/read-recipe.mjs" wasi-dig --field "$1"; }
VERSION="$(field version)"
RUST="$(field toolchain.rust)"
TARGET=wasm32-wasip1

SRC="$WORK/wasi-dig-$VERSION"
rm -rf "$SRC"
mkdir -p "$SRC"
cp -R "$HOMESCOOP_PKG/Cargo.toml" "$HOMESCOOP_PKG/Cargo.lock" "$HOMESCOOP_PKG/src" "$SRC/"
homescoop_vendor_crates "$SRC" wasix-net

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
if ! command -v rustup >/dev/null 2>&1; then
  echo "== wasi-dig: installing rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain none
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
fi
rustup toolchain install "$RUST" --profile minimal --target "$TARGET"
CARGO=(cargo "+$RUST")

echo "== wasi-dig: unit tests (host)"
(cd "$SRC" && "${CARGO[@]}" test --locked --release --quiet)

echo "== wasi-dig: cargo build ($TARGET, Rust $RUST)"
(
  cd "$SRC"
  # Keep host paths out of panic messages.
  RUSTFLAGS="--remap-path-prefix=$SRC=/wasi-dig --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo" \
    "${CARGO[@]}" build --locked --release --target "$TARGET"
)
DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
cp "$SRC/target/$TARGET/release/dig.wasm" "$DEST/bin/dig.wasm"
chmod 755 "$DEST/bin/dig.wasm"

# Every crate linked into dig.wasm (normal dependencies, as cargo resolves
# them for the target), then Rust's standard library and wasi-libc.
homescoop_notices_begin "dig.wasm (homescoop's own code and crates/wasix-net, Apache-2.0 / MIT OR Apache-2.0) statically links these crates, Rust's standard library and wasi-libc."
(cd "$SRC" && "${CARGO[@]}" metadata --locked --format-version 1 --filter-platform "$TARGET") >"$WORK/wasi-dig-metadata.json"
node - "$WORK/wasi-dig-metadata.json" >>"$HOMESCOOP_NOTICES" <<'JS'
const { readFileSync, readdirSync } = require('node:fs')
const { dirname, join } = require('node:path')
const meta = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const byId = new Map(meta.packages.map((p) => [p.id, p]))
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
const linked = new Set()
const walk = (id) => {
  for (const dep of nodes.get(id).deps) {
    if (!dep.dep_kinds.some((k) => k.kind === null)) continue
    if (linked.has(dep.pkg)) continue
    linked.add(dep.pkg)
    walk(dep.pkg)
  }
}
walk(meta.resolve.root)
const out = []
for (const p of [...linked].map((id) => byId.get(id)).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!p.source) continue // path crates: homescoop's own wasix-net
  const dir = dirname(p.manifest_path)
  const files = readdirSync(dir).filter((f) => /^(LICEN[CS]E|COPYING|NOTICE|UNLICENSE|COPYRIGHT)/i.test(f)).sort()
  if (!files.length) throw new Error(`no licence file in ${p.name} ${p.version}`)
  out.push(`\n## ${p.name} ${p.version} (${p.license})\n`)
  for (const f of files) out.push(`\n\`\`\`text\n${readFileSync(join(dir, f), 'utf8').trim()}\n\`\`\`\n`)
}
process.stdout.write(out.join(''))
JS
homescoop_notice "Rust $RUST standard library (MIT OR Apache-2.0)" \
  "https://raw.githubusercontent.com/rust-lang/rust/$RUST/COPYRIGHT" 172020dbfd5b53a226dfde77616190a48dcff519b0bc0e6deb91a8450782c4af \
  "https://raw.githubusercontent.com/rust-lang/rust/$RUST/LICENSE-MIT" b71bd43a069ca0641a9ecfe585ca7b3c53b5cc1608f8b68321168698e28b5ea1 \
  "https://raw.githubusercontent.com/rust-lang/rust/$RUST/LICENSE-APACHE" 62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a
WASI_LIBC=https://raw.githubusercontent.com/WebAssembly/wasi-libc/wasi-sdk-31
homescoop_notice "wasi-libc (wasi-sdk-31; Rust's self-contained $TARGET libc)" \
  "$WASI_LIBC/LICENSE" 2711a8b5a5cdfef0e639f96c1aca12ae23d7d64a02d0507f1bdf14d2b27bbc3a \
  "$WASI_LIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WASI_LIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af \
  "$WASI_LIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0

if strings "$DEST/bin/dig.wasm" | grep -E '/Users/|/home/runner/|/var/folders/' >/dev/null; then
  echo "homescoop: host path leaked into dig.wasm" >&2
  strings "$DEST/bin/dig.wasm" | grep -E '/Users/|/home/runner/|/var/folders/' | head >&2
  exit 1
fi
shasum -a 256 "$DEST/bin/dig.wasm"
echo "== wasi-dig: staged → $DEST ($VERSION, $(wc -c <"$DEST/bin/dig.wasm" | tr -d ' ') bytes)"
