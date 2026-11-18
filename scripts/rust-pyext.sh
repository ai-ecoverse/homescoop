#!/usr/bin/env bash
# rust-pyext.sh: Rust (pyo3) CPython extensions as wasix-python side modules.
#
# Source it from a py-* build.sh after build-common.sh and after
# install-wasixcc.sh's eval (it needs WASIXCC_SYSROOT_PREFIX). It gives every
# Rust extension the same toolchain (py-cryptography's spike, homescoop#2124):
#
# - rustc: wasix-org/rust's prebuilt toolchain, target wasm32-wasmer-wasi-dl,
#   the dynamic-linking WASIX target (PIC, shared memory, global-dynamic TLS,
#   rust-lld -shared --unresolved-symbols=import-dynamic, scrt1.o's
#   __wasix_init_tls). Its std is prebuilt with panic=abort, so the Rust code
#   carries no exception-handling instructions and no -Zbuild-std is needed;
#   a Rust panic aborts python (no pyo3 PanicException).
# - cargo: Rust 1.98.1's, sha-pinned by install-rust.sh (cargo only; build
#   scripts compile with the wasix rustc's own host std).
# - C (the cc crate): wasixcc with legacy wasm EH and PIC, as the C py-* side
#   modules and python.wasm are built.
# - link: no libc (python.wasm exports it), the pinned sysroot-ehpic's
#   scrt1.o, -Bsymbolic so two Rust side modules never bind each other's std.
#
#   homescoop_rust_pyext_toolchain <dir>                 # exports RUSTC, PATH, CC_*, RUSTFLAGS
#   homescoop_rust_pyext_target_lexicon <src> <crate> <version>
#   homescoop_rust_pyext_pyo3_config <file>              # CPython 3.15 abi3, wasm32
#   homescoop_rust_pyext_check <so> <python.wasm> <module>
#
# The target-lexicon step exists because pyo3-build-config parses the target
# triple with target-lexicon, which doesn't know the `dl` environment; the
# crates.io release named in the extension's Cargo.lock is vendored with
# scripts/rust-pyext/target-lexicon-dl.patch through [patch.crates-io]
# (wasix-org/build-scripts does the same with a git fork). It's a build
# dependency of pyo3's build script only; nothing of it reaches the wasm.

HOMESCOOP_RUST_PYEXT_TARGET=wasm32-wasmer-wasi-dl
# wasix-org/rust release (also wasix-websocat's toolchain.wasix_rust).
HOMESCOOP_RUST_PYEXT_WASIX_RUST="v2026-09-18.1+rust-1.97"
HOMESCOOP_RUST_PYEXT_CARGO="1.98.1"

homescoop_rust_pyext_toolchain() {
  local dir="${1:?homescoop_rust_pyext_toolchain <dir>}" asset sha tgz wr
  : "${WASIXCC_SYSROOT_PREFIX:?homescoop_rust_pyext_toolchain: eval install-wasixcc.sh first}"
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64)
      asset=rust-toolchain-x86_64-unknown-linux-gnu.tar.gz
      sha=b57356d9592fdf6aa7c3b65f83ad7b6c9879a99263b6337f04ee652c704cacd9 ;;
    Darwin-arm64)
      asset=rust-toolchain-aarch64-apple-darwin.tar.gz
      sha=815927a3894ac7a0d4b9709a5825a85678c94733225b9e4da574cfb9674b4059 ;;
    *) echo "rust-pyext: no pinned wasix-org/rust toolchain for $(uname -s)-$(uname -m)" >&2; return 1 ;;
  esac
  mkdir -p "$dir"
  tgz="$dir/wasix-rust-$asset"
  homescoop_fetch "https://github.com/wasix-org/rust/releases/download/${HOMESCOOP_RUST_PYEXT_WASIX_RUST//+/%2B}/$asset" "$sha" "$tgz"
  wr="$dir/wasix-rust-$HOMESCOOP_RUST_PYEXT_WASIX_RUST"
  if [[ ! -x "$wr/bin/rustc" ]]; then
    rm -rf "$wr"
    mkdir -p "$wr"
    tar xzf "$tgz" -C "$wr"
    chmod +x "$wr"/bin/* "$wr"/lib/rustlib/*/bin/* "$wr"/lib/rustlib/*/bin/gcc-ld/* 2>/dev/null || true
  fi
  test -d "$wr/lib/rustlib/$HOMESCOOP_RUST_PYEXT_TARGET/lib" ||
    { echo "rust-pyext: $HOMESCOOP_RUST_PYEXT_WASIX_RUST has no $HOMESCOOP_RUST_PYEXT_TARGET std" >&2; return 1; }
  eval "$(bash "$HOMESCOOP_ROOT/scripts/install-rust.sh" "$HOMESCOOP_RUST_PYEXT_CARGO" "$dir/rust-$HOMESCOOP_RUST_PYEXT_CARGO")"
  export HOMESCOOP_RUST_PYEXT_WR="$wr"
  export RUSTC="$wr/bin/rustc"
  "$RUSTC" -vV >&2

  local ehpic="$WASIXCC_SYSROOT_PREFIX/sysroot-ehpic/lib/wasm32-wasip1"
  test -f "$ehpic/scrt1.o" || { echo "rust-pyext: $ehpic/scrt1.o missing" >&2; return 1; }
  export CC_wasm32_wasmer_wasi_dl=wasixcc AR_wasm32_wasmer_wasi_dl=wasixar
  export CFLAGS_wasm32_wasmer_wasi_dl="-matomics -mbulk-memory -mmutable-globals -pthread"
  export WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes WASIXCC_RUN_WASM_OPT=no
  HOMESCOOP_RUST_PYEXT_RUSTFLAGS=(
    -C link-self-contained=no
    -L "native=$ehpic"
    -C "link-arg=$ehpic/scrt1.o"
    -C link-arg=-Bsymbolic
    -C link-arg=--experimental-pic
    -C codegen-units=1
    "--remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo"
    "--remap-path-prefix=$wr=/wasix-rust"
  )
}

# Append --remap-path-prefix for a source tree and export the flags
# (CARGO_ENCODED_RUSTFLAGS keeps paths with spaces whole).
homescoop_rust_pyext_rustflags() {
  local src="${1:?homescoop_rust_pyext_rustflags <src> [name]}" name="${2:-src}" IFS=$'\x1f'
  local -a flags=("${HOMESCOOP_RUST_PYEXT_RUSTFLAGS[@]}" "--remap-path-prefix=$src=/$name" "--remap-path-prefix=$(cd "$src" && pwd -P)=/$name")
  export CARGO_ENCODED_RUSTFLAGS="${flags[*]}"
  unset RUSTFLAGS
}

# Vendor target-lexicon <version> (the .crate at <crate>) into
# <src>/homescoop-crates/target-lexicon-<version> with the `dl` environment, and point
# the workspace at it. The Cargo.lock entry loses its registry source and
# checksum (a path dependency's lock entry has neither), so --locked holds.
homescoop_rust_pyext_target_lexicon() {
  local src="${1:?}" crate="${2:?}" version="${3:?}" dest
  dest="$src/homescoop-crates/target-lexicon-$version"
  rm -rf "$dest" && mkdir -p "$dest"
  tar xzf "$crate" -C "$dest" --strip-components=1
  grep -q "^version = \"$version\"$" "$dest/Cargo.toml" ||
    { echo "rust-pyext: $crate is not target-lexicon $version" >&2; return 1; }
  patch -d "$dest" -p1 --no-backup-if-mismatch -s <"$HOMESCOOP_ROOT/scripts/rust-pyext/target-lexicon-dl.patch"
  if grep -q '^\[patch\.crates-io\]' "$src/Cargo.toml"; then
    echo "rust-pyext: $src/Cargo.toml already has [patch.crates-io]; extend homescoop_rust_pyext_target_lexicon" >&2
    return 1
  fi
  printf '\n# homescoop (scripts/rust-pyext.sh): target-lexicon with the wasm32-wasmer-wasi-dl environment.\n[patch.crates-io]\ntarget-lexicon = { path = "homescoop-crates/target-lexicon-%s" }\n' "$version" >>"$src/Cargo.toml"
  node - "$src/Cargo.lock" "$version" <<'JS'
const fs = require('fs');
const [file, version] = process.argv.slice(2);
const lock = fs.readFileSync(file, 'utf8');
const blocks = lock.split('\n[[package]]\n');
let hits = 0;
const out = blocks.map((b) => {
  if (!b.startsWith(`name = "target-lexicon"\nversion = "${version}"\n`)) return b;
  hits++;
  return b.split('\n').filter((l) => !/^(source|checksum) = /.test(l)).join('\n');
});
if (hits !== 1) { console.error(`rust-pyext: Cargo.lock has ${hits} target-lexicon ${version} entries, want 1`); process.exit(1); }
fs.writeFileSync(file, out.join('\n[[package]]\n'));
JS
}

# A pyo3 build config for wasix-python 3.15: the limited API (abi3), 32-bit
# pointers, no libpython to link (python.wasm resolves the C API at dlopen).
homescoop_rust_pyext_pyo3_config() {
  local file="${1:?homescoop_rust_pyext_pyo3_config <file>}"
  cat >"$file" <<'EOF'
implementation=CPython
version=3.15
shared=true
abi3=true
lib_name=python3.15
pointer_width=32
build_flags=
suppress_build_script_link_lines=true
EOF
  export PYO3_CONFIG_FILE="$file"
}

# The side module must dlopen into python.wasm: dylink.0, PyInit_<module>,
# __wasix_init_tls, every env/GOT import exported by python.wasm (or by the
# module itself), and no exception-handling instructions to mismatch
# python.wasm's legacy EH.
homescoop_rust_pyext_check() {
  node "$HOMESCOOP_ROOT/scripts/rust-pyext/check-side-module.mjs" "$@"
}
