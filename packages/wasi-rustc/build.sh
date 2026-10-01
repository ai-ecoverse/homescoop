#!/usr/bin/env bash
# Historical 1.83.0-1 spike from oligamiq release artifacts. For the patched
# 1.83.0-2 built by x.py in CI, use stage-patched.py with the workflow artifact.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-rustc

PKG_WORK="$HOMESCOOP_PKG/work"
PKG="$HOMESCOOP_PKG/package"
SPIKE_VER="${HOMESCOOP_NPM_VER:-1.83.0-1}"
BASE="https://github.com/oligamiq/rust_wasm/releases/download/v3.0.0-release"

mkdir -p "$PKG_WORK" "$PKG/bin" "$PKG/lib/rustlib/wasm32-wasip1/lib"

fetch() {
  local url="$1" out="$2"
  if [[ ! -f "$out" || -n "${FORCE:-}" ]]; then
    echo "== fetch $(basename "$out")"
    curl -fL --retry 3 -o "$out" "$url"
  else
    echo "== have $(basename "$out")"
  fi
}

echo "== wasi-rustc: fetch spike artifacts (oligamiq v3.0.0 / rustc 1.83.0-dev)"
fetch "$BASE/rustc_opt.wasm.tar.gz" "$PKG_WORK/rustc_opt.wasm.tar.gz"
fetch "$BASE/wasm32-wasip1.tar.gz" "$PKG_WORK/wasm32-wasip1.tar.gz"
# llvm_opt.wasm is a separate LLVM `opt` tool, not required for rustc codegen
# in this cut (LLVM is linked into rustc_opt.wasm). Kept optional for later.

echo "== wasi-rustc: extract + stage"
STAGE="$PKG_WORK/stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/sys"
tar xzf "$PKG_WORK/rustc_opt.wasm.tar.gz" -C "$STAGE"
# Prefer already-extracted copy if present
if [[ -f "$PKG_WORK/oligamiq-rustc/rustc_opt.wasm" ]]; then
  cp "$PKG_WORK/oligamiq-rustc/rustc_opt.wasm" "$STAGE/rustc_opt.wasm"
fi
tar xzf "$PKG_WORK/wasm32-wasip1.tar.gz" -C "$STAGE/sys"

rm -rf "$PKG"
mkdir -p "$PKG/bin" "$PKG/lib/rustlib/wasm32-wasip1/lib"
cp "$STAGE/rustc_opt.wasm" "$PKG/bin/rustc.wasm"
# Sysroot rlibs (+ self-contained crt) land under lib/rustlib/wasm32-wasip1/lib
cp -R "$STAGE/sys/"* "$PKG/lib/rustlib/wasm32-wasip1/lib/"
# Also keep a flat extract cache for rebuilds
mkdir -p "$PKG_WORK/sysroot-wasip1" "$PKG_WORK/oligamiq-rustc"
cp -R "$STAGE/sys/"* "$PKG_WORK/sysroot-wasip1/" 2>/dev/null || true
cp "$STAGE/rustc_opt.wasm" "$PKG_WORK/oligamiq-rustc/rustc_opt.wasm"

if find "$PKG" -type l | grep -q .; then
  echo "FAIL: symlinks present in package/" >&2
  find "$PKG" -type l >&2
  exit 1
fi

# Driver: default --target wasm32-wasip1 + --sysroot (SLICC script command)
cat > "$PKG/bin/rustc" <<'EOF'
#!/bin/sh
# homescoop wasi-rustc driver — default target + sysroot so `rustc hello.rs` works.
# Linker: currently rust-lld (bundled in rustc.wasm). Next cut: -C linker=wasm-ld
# from @ai-ecoverse/wasm-clang over WASIX spawn.
set -eu
SCRIPT=$0
# The package has no symlinks. Resolve its directory with shell builtins so
# the driver works before coreutils has been installed into SLICC.
case $SCRIPT in
  */*) ;;
  *) SCRIPT=$(command -v "$SCRIPT") ;;
esac
BINDIR=$(CDPATH= cd -- "${SCRIPT%/*}" && pwd)
PKGROOT=$(CDPATH= cd -- "$BINDIR/.." && pwd)

has_target=0
has_sysroot=0
for a in "$@"; do
  case "$a" in
    --target|--target=*) has_target=1 ;;
    --sysroot|--sysroot=*) has_sysroot=1 ;;
  esac
done

set -- "$@"
# Rebuild argv with optional defaults prepended
extra=
if [ "$has_sysroot" -eq 0 ]; then
  extra="$extra --sysroot=$PKGROOT"
fi
if [ "$has_target" -eq 0 ]; then
  extra="$extra --target=wasm32-wasip1"
fi
# The wasm host std in 1.83.0-0 panics in env::split_paths when PATH exists.
# rustc's default bundled rust-lld needs no PATH. Restore it in 1.83.0-2.
unset PATH
# shellcheck disable=SC2086
exec "$BINDIR/rustc.wasm" $extra "$@"
EOF
chmod +x "$PKG/bin/rustc"

cat > "$PKG/LICENSE" <<'EOF'
Rust is dual-licensed under MIT OR Apache-2.0.
This package redistributes a rustc (LLVM-in-wasm) build derived from the
bjorn3 / oligamiq rustc-in-wasm work and the Rust Project.

See https://github.com/rust-lang/rust and SPIKE.md for provenance.
EOF

cat > "$PKG/README.md" <<EOF
# @ai-ecoverse/wasi-rustc

\`rustc\` (LLVM-in-wasm) for **slicc**. Host: \`wasm32-wasip1-threads\`.
Default compile target: **wasm32-wasip1**.

## Spike cut \`${SPIKE_VER}\`

- Works: \`rustc --version\`, \`rustc hello.rs\` → \`hello.wasm\`, \`-O\`,
  \`std::fs\` / \`env\` / \`process::exit\`
- Linker: **rust-lld** (bundled). Next: spawn \`wasm-ld\` from
  \`@ai-ecoverse/wasm-clang\` over WASIX (\`-C linker=wasm-ld\` in target spec).
- The driver unsets PATH just before launching rustc.wasm to avoid a host std
  panic in this cut. The default bundled rust-lld works without PATH; custom
  linker commands that need PATH are unsupported until the patched rebuild.
- Cargo: deferred
- Provenance: oligamiq/rust_wasm v3.0.0 \`rustc_opt.wasm\` + \`wasm32-wasip1\`
  sysroot (bjorn3 \`compile_rustc_for_wasm\` lineage). In-tree \`x.py\` replaces this.

## Layout

- \`bin/rustc\` — shell driver (injects \`--sysroot\` + \`--target\`)
- \`bin/rustc.wasm\` — compiler (wasip1-threads host)
- \`lib/rustlib/wasm32-wasip1/\` — std/core/alloc + self-contained crt

## Environment

- \`RUST_MIN_STACK=16777216\` recommended (large LLVM stack)
- Run dep: \`@ai-ecoverse/wasm-clang\` (for upcoming wasm-ld spawn)

## Sizes (this cut)

See SPIKE.md / publish report.
EOF

cat > "$PKG/PRESTAGE.md" <<'EOF'
# wasi-rustc PRESTAGE

- `rustc --version` under wasmer `--enable-threads` (or SLICC)
- Caller PATH set; driver unsets it before launching rustc.wasm
- `rustc hello.rs -o hello.wasm` (driver supplies `--sysroot` + `--target`)
- `-O` build using `std::fs` / `std::env` / `std::process::exit` succeeds
- tarball has no symlinks/hardlinks
EOF
cp "$PKG/PRESTAGE.md" "$HOMESCOOP_PKG/PRESTAGE.md"
cp "$PKG/README.md" "$HOMESCOOP_PKG/README.md"

node <<NODE
const fs = require('fs');
const path = require('path');
const pkgDir = process.env.HOMESCOOP_PKG + '/package';
const ver = process.env.HOMESCOOP_NPM_VER || '${SPIKE_VER}';
const j = {
  name: '@ai-ecoverse/wasi-rustc',
  version: ver,
  description: 'rustc (LLVM-in-wasm) for slicc WASI — default target wasm32-wasip1',
  license: 'MIT OR Apache-2.0',
  repository: {
    type: 'git',
    url: 'git+https://github.com/ai-ecoverse/homescoop.git',
    directory: 'packages/wasi-rustc/package',
  },
  homepage: 'https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasi-rustc',
  keywords: ['wasm', 'wasi', 'slicc', 'homescoop', 'rustc', 'rust'],
  files: ['README.md', 'LICENSE', 'PRESTAGE.md', 'bin', 'lib'],
  publishConfig: { access: 'public' },
  homescoop: { recipe: 'wasi-rustc', upstream: '1.83.0-dev', spike: true },
  slicc: {
    abi: 'wasi',
    dependencies: ['@ai-ecoverse/wasm-clang'],
    commands: {
      rustc: { script: 'bin/rustc' },
      'rustc.wasm': {
        wasm: 'bin/rustc.wasm',
        env: { RUST_MIN_STACK: '16777216' },
      },
    },
    env: {
      RUST_MIN_STACK: '16777216',
      RUSTC_SYSROOT: '\${package}',
    },
  },
};
fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify(j, null, 2) + '\\n');
NODE

# ── PRESTAGE ──────────────────────────────────────────────────────────
echo "== wasi-rustc: PRESTAGE (wasmer --enable-threads)"
ABS="$PKG"
mkdir -p "$PKG_WORK/prestage"
echo 'fn main() { println!("hello wasi-rustc"); }' > "$PKG_WORK/prestage/hello.rs"
cat > "$PKG_WORK/prestage/stdhello.rs" <<'RS'
fn main() {
  let a: u32 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(2);
  let _ = std::fs::metadata(".");
  println!("ok {}", a);
  std::process::exit(0);
}
RS

run_rustc() {
  # Direct wasm (PRESTAGE under wasmer; driver is for SLICC script path).
  # The 1.83.0-1 driver removes caller PATH before exec; direct wasm must
  # receive the same child environment. The patched 1.83.0-2 restores PATH.
  /usr/bin/time -l wasmer run --enable-threads \
    --volume "${ABS}:/" \
    --volume "${PKG_WORK}/prestage:/tmp" \
    --env RUST_MIN_STACK=16777216 \
    --env HOME=/home \
    --env TMPDIR=/tmp \
    --env LD_LIBRARY_PATH=/lib \
    "${ABS}/bin/rustc.wasm" -- "$@"
}

echo "  --version"
run_rustc --version 2>&1 | tee "$PKG_WORK/prestage/version.txt" | head -5
grep -q 'rustc' "$PKG_WORK/prestage/version.txt"

echo "  hello.rs (no -O)"
run_rustc --sysroot / --target wasm32-wasip1 \
  /tmp/hello.rs -o /tmp/hello.wasm 2>&1 | tee "$PKG_WORK/prestage/hello-compile.txt" | tail -3
test -s "$PKG_WORK/prestage/hello.wasm"
wasmtime run "$PKG_WORK/prestage/hello.wasm" | tee "$PKG_WORK/prestage/hello.out"
grep -q 'hello wasi-rustc' "$PKG_WORK/prestage/hello.out"

echo "  stdhello.rs -O (fs/env/exit)"
run_rustc --sysroot / --target wasm32-wasip1 -O \
  /tmp/stdhello.rs -o /tmp/stdhello.wasm 2>&1 | tee "$PKG_WORK/prestage/stdhello-compile.txt" | tail -3
test -s "$PKG_WORK/prestage/stdhello.wasm"
wasmtime run --dir=. "$PKG_WORK/prestage/stdhello.wasm" 7 | tee "$PKG_WORK/prestage/stdhello.out"
grep -q 'ok 7' "$PKG_WORK/prestage/stdhello.out"

# Sizes + timings summary
{
  echo "=== wasi-rustc ${SPIKE_VER} PRESTAGE report ==="
  echo "rustc.wasm: $(du -h "$PKG/bin/rustc.wasm" | awk '{print $1}') ($(wc -c < "$PKG/bin/rustc.wasm") bytes)"
  echo "rustlib:    $(du -sh "$PKG/lib/rustlib" | awk '{print $1}')"
  echo "package:    $(du -sh "$PKG" | awk '{print $1}')"
  echo "hello.wasm: $(wc -c < "$PKG_WORK/prestage/hello.wasm") bytes"
  echo "stdhello:   $(wc -c < "$PKG_WORK/prestage/stdhello.wasm") bytes"
  echo "--- timings (wasmer --enable-threads, from /usr/bin/time -l) ---"
  rg -n 'real|maximum resident' "$PKG_WORK/prestage/version.txt" "$PKG_WORK/prestage/hello-compile.txt" "$PKG_WORK/prestage/stdhello-compile.txt" || true
} | tee "$PKG_WORK/prestage/REPORT.txt"

echo "== wasi-rustc: pack"
TGZ="$(homescoop_npm_pack_no_links "$PKG" "$PKG_WORK")"
echo "  packed $(basename "$TGZ") ($(du -h "$TGZ" | awk '{print $1}'))"
echo "== wasi-rustc: staged → $PKG ($SPIKE_VER)"
du -sh "$PKG/bin/rustc.wasm" "$PKG/lib/rustlib" "$TGZ"
cat "$PKG_WORK/prestage/REPORT.txt"
