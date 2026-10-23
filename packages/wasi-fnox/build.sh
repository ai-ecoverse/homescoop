#!/usr/bin/env bash
# wasi-fnox: build fnox (jdx/fnox v1.40.0 plus packages/wasi-fnox/*.patch,
# applied by apply.sh) for wasm32-wasip1, shrink it with wasm-opt, and stage
# bin/fnox.wasm with LICENSE and THIRD-PARTY-NOTICES.md.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-fnox
field() { node "$ROOT/scripts/read-recipe.mjs" wasi-fnox --field "$1"; }
RUST="$(field toolchain.rust)"
BINARYEN="$(field toolchain.binaryen)"
TARGET=wasm32-wasip1

TARBALL="$WORK/fnox-v$VERSION.tar.gz"
SRC_DIR="$WORK/fnox-$VERSION"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
# Always from a fresh extract: apply.sh refuses a tree it has patched.
rm -rf "$SRC_DIR"
homescoop_extract "$TARBALL" "$SRC_DIR"
bash "$HOMESCOOP_PKG/apply.sh" "$SRC_DIR" "$ROOT"

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
if ! command -v rustup >/dev/null 2>&1; then
  echo "== wasi-fnox: installing rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain none
  export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:${PATH}"
fi
rustup toolchain install "$RUST" --profile minimal --target "$TARGET"
CARGO=(cargo "+$RUST")

# binaryen, pinned as in scripts/install-wasixcc.sh.
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    BINARYEN_ASSET="binaryen-version_${BINARYEN}-x86_64-linux.tar.gz"
    BINARYEN_SHA="2dc9c7813f5375db93d96ead4b78222fcc3e2677bbb832297af4797782a37489" ;;
  Darwin-arm64)
    BINARYEN_ASSET="binaryen-version_${BINARYEN}-arm64-macos.tar.gz"
    BINARYEN_SHA="ad66da82ac13f163e424b1643f16c6dfcccc98b5966296b43e52d3cab04f84a8" ;;
  *) echo "wasi-fnox: no pinned binaryen for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
homescoop_fetch "https://github.com/WebAssembly/binaryen/releases/download/version_$BINARYEN/$BINARYEN_ASSET" \
  "$BINARYEN_SHA" "$WORK/$BINARYEN_ASSET"
BINARYEN_DIR="$WORK/binaryen-version_$BINARYEN"
test -x "$BINARYEN_DIR/bin/wasm-opt" || tar xzf "$WORK/$BINARYEN_ASSET" -C "$WORK"
WASM_OPT="$BINARYEN_DIR/bin/wasm-opt"

echo "== wasi-fnox: cargo build --bin fnox ($TARGET, Rust $RUST)"
(
  cd "$SRC_DIR"
  # tokio refuses io-std and fs on wasm without tokio_unstable. No
  # -C strip: it drops the target_features section wasm-opt reads. Panic
  # locations name source files: map the build machine's paths away.
  # Cargo hands rustc the physical path of OUT_DIR (macOS: /private/var/…,
  # /private/tmp/…), so map that spelling too. rust-embed (age's i18n
  # files) stores each file's times, and a file's birth time is when cargo
  # unpacked the crate on this machine (homescoop#364): SOURCE_DATE_EPOCH,
  # the v1.40.0 tag's commit time, replaces both, so builds are byte-identical.
  SOURCE_DATE_EPOCH="$(field source.epoch)" \
  RUSTFLAGS="--cfg tokio_unstable -C codegen-units=1 --remap-path-prefix=$SRC_DIR=/fnox --remap-path-prefix=$(pwd -P)=/fnox --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo" \
    "${CARGO[@]}" build --locked --release --bin fnox --target "$TARGET"
)
WASM="$SRC_DIR/target/$TARGET/release/fnox.wasm"
test -f "$WASM"

DEST="$HOMESCOOP_PKG/package"
mkdir -p "$DEST/bin"
before=$(wc -c <"$WASM" | tr -d ' ')
"$WASM_OPT" -Oz --strip-debug \
  --enable-bulk-memory --enable-multivalue --enable-reference-types \
  --enable-nontrapping-float-to-int --enable-sign-ext \
  "$WASM" -o "$DEST/bin/fnox.wasm"
chmod 755 "$DEST/bin/fnox.wasm"
echo "== wasi-fnox: wasm-opt $before → $(wc -c <"$DEST/bin/fnox.wasm" | tr -d ' ') bytes"

homescoop_stage_license "$SRC_DIR/LICENSE"

# Every crate linked into fnox.wasm (normal dependencies, as cargo resolves
# them for the target), then Rust's standard library and wasi-libc.
homescoop_notices_begin "fnox.wasm (fnox, MIT, see LICENSE, with homescoop's patches; homescoop's crates/wasix-command, MIT OR Apache-2.0) statically links these crates, Rust's standard library and wasi-libc."
(cd "$SRC_DIR" && "${CARGO[@]}" metadata --locked --format-version 1 --filter-platform "$TARGET") >"$WORK/wasi-fnox-metadata.json"
node - "$WORK/wasi-fnox-metadata.json" >>"$HOMESCOOP_NOTICES" <<'JS'
const { readFileSync, readdirSync } = require('node:fs')
const { dirname, join } = require('node:path')
const meta = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const byId = new Map(meta.packages.map((p) => [p.id, p]))
const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
const root = meta.packages.find((p) => p.name === 'fnox' && !p.source)
// Crates that ship no licence file; their texts follow from pinned
// upstream URLs below (the whole name@version, so a bump fails loudly).
const fetched = new Set(['age@0.12.1', 'age-core@0.12.0', 'cookie-factory@0.3.3', 'fluent-langneg@0.13.1', 'intl_pluralrules@7.0.2', 'backtrace-ext@0.2.1', 'usage-test@7.0.1', 'io_tee@0.1.1'])
const linked = new Set()
const walk = (id) => {
  for (const dep of nodes.get(id).deps) {
    if (!dep.dep_kinds.some((k) => k.kind === null)) continue
    if (linked.has(dep.pkg)) continue
    linked.add(dep.pkg)
    walk(dep.pkg)
  }
}
walk(root.id)
const out = []
for (const p of [...linked].map((id) => byId.get(id)).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!p.source) continue // path crates: fnox-core, fnox-client, wasix-command
  if (fetched.has(`${p.name}@${p.version}`)) continue
  const dir = dirname(p.manifest_path)
  const files = readdirSync(dir).filter((f) => /^(LICEN[CS]E|COPYING|NOTICE|UNLICENSE|COPYRIGHT)/i.test(f)).sort()
  if (!files.length) throw new Error(`no licence file in ${p.name} ${p.version}`)
  out.push(`\n## ${p.name} ${p.version} (${p.license})\n`)
  for (const f of files) out.push(`\n\`\`\`text\n${readFileSync(join(dir, f), 'utf8').trim()}\n\`\`\`\n`)
}
process.stdout.write(out.join(''))
JS
GH=https://raw.githubusercontent.com
homescoop_notice "age 0.12.1 and age-core 0.12.0 (MIT OR Apache-2.0; str4d/rage v0.12.1)" \
  "$GH/str4d/rage/v0.12.1/LICENSE-MIT" fe56c030c2d8c3404a37fe711cebb27ebea13d0aacf7e3524db4198335ad8cd1 \
  "$GH/str4d/rage/v0.12.1/LICENSE-APACHE" 3708458dee7f359ac6c9c5558023ed481be87e5372c43ebd7f2ca7ad23c12026
homescoop_notice "cookie-factory 0.3.3 (MIT)" \
  "$GH/rust-bakery/cookie-factory/0.3.3/LICENSES/MIT.txt" d09216dc1ea5f273997667935a8d6514d80f00b89fb6954ecc3a43e0a6e360de
homescoop_notice "fluent-langneg 0.13.1 (Apache-2.0 OR MIT)" \
  "$GH/projectfluent/fluent-langneg-rs/fluent-langneg%400.13.1/LICENSE-MIT" 016fcc02048817d628b04b140c54db290fd9d29a5e8a55b77871194e810716ac \
  "$GH/projectfluent/fluent-langneg-rs/fluent-langneg%400.13.1/LICENSE-APACHE" b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1
homescoop_notice "intl_pluralrules 7.0.2 (Apache-2.0/MIT)" \
  "$GH/zbraniecki/pluralrules/d0715d5b7cca72e228d6e6c4de154bd30dfdd06a/intl_pluralrules/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$GH/zbraniecki/pluralrules/d0715d5b7cca72e228d6e6c4de154bd30dfdd06a/intl_pluralrules/LICENSE-APACHE" 62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a
homescoop_notice "backtrace-ext 0.2.1 (MIT OR Apache-2.0)" \
  "$GH/gankra/backtrace-ext/fddf332db86efec661464ca5c2c8854679e1adb2/LICENSE-MIT" d73748752e021954f65284717512f6e5814887b6ab1a7f7ded102eb7664bd319 \
  "$GH/gankra/backtrace-ext/fddf332db86efec661464ca5c2c8854679e1adb2/LICENSE-APACHE" a65e5d531cc9c3493edac54367d7c561eb8aa228585e8950632b995628279a6a
homescoop_notice "usage-test 7.0.1 (MIT)" \
  "$GH/jdx/usage/v7.0.1/LICENSE" f68207e9c8798c1a64d04ad674e042eddb56d679d5294683e0ae57afff3562d6
# io_tee publishes no licence text anywhere; Cargo.toml says MIT OR
# Apache-2.0, so the SPDX texts stand in.
homescoop_notice "io_tee 0.1.1 (MIT OR Apache-2.0; no licence file published, SPDX texts)" \
  "$GH/spdx/license-list-data/v3.29.0/text/MIT.txt" b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5 \
  "$GH/spdx/license-list-data/v3.29.0/text/Apache-2.0.txt" 074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff
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

if strings "$DEST/bin/fnox.wasm" | grep -E '/Users/|/home/runner/|/var/folders/|/private/(tmp|var)/' >/dev/null; then
  echo "homescoop: host path leaked into fnox.wasm" >&2
  strings "$DEST/bin/fnox.wasm" | grep -E '/Users/|/home/runner/|/var/folders/|/private/(tmp|var)/' | head >&2
  exit 1
fi
shasum -a 256 "$DEST/bin/fnox.wasm"
echo "== wasi-fnox: staged → $DEST ($VERSION + $(ls "$HOMESCOOP_PKG"/[0-9][0-9][0-9][0-9]-*.patch | wc -l | tr -d ' ') patches, $(wc -c <"$DEST/bin/fnox.wasm" | tr -d ' ') bytes)"
