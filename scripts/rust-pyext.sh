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
#   homescoop_rust_pyext_patch_crate <src> <crate> <name> <version>   # scripts/rust-pyext/<name>-dl.patch
#   homescoop_rust_pyext_pyo3_config <file>              # CPython 3.15 abi3, wasm32
#   homescoop_rust_pyext_check <so> <python.wasm> <module>
#   homescoop_rust_pyext_no_build_paths <build dir> <so>
#   homescoop_rust_pyext_record <hostpy> <site> <top> <dist-info>   # wheel RECORD
#   homescoop_rust_pyext_notices <crate dir> <build dir>            # crates, Rust std, scrt1.o
#
# The target-lexicon step exists because pyo3-build-config parses the target
# triple with target-lexicon, which doesn't know the `dl` environment; the
# crates.io release named in the extension's Cargo.lock is vendored with
# scripts/rust-pyext/target-lexicon-dl.patch through [patch.crates-io]
# (wasix-org/build-scripts does the same with a git fork). It's a build
# dependency of pyo3's build script only; nothing of it reaches the wasm.
# Other crates that select a backend by target_env (getrandom 0.3: p1/p2)
# get a scripts/rust-pyext/<name>-dl.patch the same way.

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

# Vendor crates.io crate <name> <version> (the .crate at <crate>) into
# <src>/homescoop-crates/<name>-<version>, apply
# scripts/rust-pyext/<name>-dl.patch, and point the manifest at <src> (the
# workspace root, next to its Cargo.lock) at it through [patch.crates-io].
# The Cargo.lock entry loses its registry source and checksum (a path
# dependency's lock entry has neither), so --locked holds.
homescoop_rust_pyext_patch_crate() {
  local src="${1:?}" crate="${2:?}" name="${3:?}" version="${4:?}" dest marker
  local patchfile="$HOMESCOOP_ROOT/scripts/rust-pyext/$name-dl.patch"
  test -f "$patchfile" || { echo "rust-pyext: no $patchfile" >&2; return 1; }
  dest="$src/homescoop-crates/$name-$version"
  rm -rf "$dest" && mkdir -p "$dest"
  tar xzf "$crate" -C "$dest" --strip-components=1
  grep -q "^name = \"$name\"$" "$dest/Cargo.toml" && grep -q "^version = \"$version\"$" "$dest/Cargo.toml" ||
    { echo "rust-pyext: $crate is not $name $version" >&2; return 1; }
  patch -d "$dest" -p1 --no-backup-if-mismatch -s <"$patchfile"
  marker='# homescoop (scripts/rust-pyext.sh): crates patched for wasm32-wasmer-wasi-dl.'
  if ! grep -qxF "$marker" "$src/Cargo.toml"; then
    if grep -q '^\[patch\.crates-io\]' "$src/Cargo.toml"; then
      echo "rust-pyext: $src/Cargo.toml already has its own [patch.crates-io]; extend homescoop_rust_pyext_patch_crate" >&2
      return 1
    fi
    printf '\n%s\n[patch.crates-io]\n' "$marker" >>"$src/Cargo.toml"
  fi
  tail -n 1 "$src/Cargo.toml" | grep -q '^[a-z0-9_-]* = { path = "homescoop-crates/\|^\[patch\.crates-io\]$' ||
    { echo "rust-pyext: $src/Cargo.toml: [patch.crates-io] is not the last section" >&2; return 1; }
  printf '%s = { path = "homescoop-crates/%s-%s" }\n' "$name" "$name" "$version" >>"$src/Cargo.toml"
  node - "$src/Cargo.lock" "$name" "$version" <<'JS'
const fs = require('fs');
const [file, name, version] = process.argv.slice(2);
const lock = fs.readFileSync(file, 'utf8');
const blocks = lock.split('\n[[package]]\n');
let hits = 0;
const out = blocks.map((b) => {
  if (!b.startsWith(`name = "${name}"\nversion = "${version}"\n`)) return b;
  hits++;
  return b.split('\n').filter((l) => !/^(source|checksum) = /.test(l)).join('\n');
});
if (hits !== 1) { console.error(`rust-pyext: Cargo.lock has ${hits} ${name} ${version} entries, want 1`); process.exit(1); }
fs.writeFileSync(file, out.join('\n[[package]]\n'));
JS
}

# target-lexicon with the `dl` environment (every pyo3 extension needs it).
homescoop_rust_pyext_target_lexicon() {
  homescoop_rust_pyext_patch_crate "${1:?}" "${2:?}" target-lexicon "${3:?}"
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

# No path of this build in the module. The prebuilt wasix-org std carries
# its own CI's cargo paths in panic locations (/home/runner/.cargo/... for
# the Linux toolchain, /Users/runner/... for macOS), which can look like
# ours on a runner; a string that is also in the target's std rlibs is the
# toolchain's fixed bytes, not a leak.
homescoop_rust_pyext_no_build_paths() {
  local b="${1:?}" so="${2:?}" line
  local -a leaks=(-e "$b" -e "$(cd "$b" && pwd -P)" -e "$HOME" -e "${CARGO_HOME:-$HOME/.cargo}")
  strings "$HOMESCOOP_RUST_PYEXT_WR/lib/rustlib/$HOMESCOOP_RUST_PYEXT_TARGET/lib/"*.rlib | grep -F "${leaks[@]}" >"$b/std-strings.txt" || true
  strings "$so" | grep -F "${leaks[@]}" >"$b/leaks.txt" || true
  : >"$b/leaks-own.txt"
  while IFS= read -r line; do
    grep -qF -- "$line" "$b/std-strings.txt" || printf '%s\n' "$line" >>"$b/leaks-own.txt"
  done <"$b/leaks.txt"
  if [[ -s "$b/leaks-own.txt" ]]; then
    echo "rust-pyext: a build path leaked into $(basename "$so")" >&2
    head "$b/leaks-own.txt" >&2
    return 1
  fi
  echo "== rust-pyext: no build path in $(basename "$so") ($(wc -l <"$b/leaks.txt" | tr -d ' ') toolchain std paths, all in the prebuilt std)"
}

# A wheel RECORD for <site>/<top> and <site>/<dist-info>.
homescoop_rust_pyext_record() {
  "${1:?}" - "${2:?}" "${3:?}" "${4:?}" <<'PY'
import base64, hashlib, os, sys
site, top, di = sys.argv[1], sys.argv[2], sys.argv[3]
rows = []
for t in (top, di):
    for d, _, files in sorted(os.walk(os.path.join(site, t))):
        for f in sorted(files):
            p = os.path.join(d, f)
            rel = os.path.relpath(p, site)
            if rel == f"{di}/RECORD" or "__pycache__" in rel:
                continue
            data = open(p, "rb").read()
            h = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
            rows.append(f"{rel},sha256={h},{len(data)}")
rows.append(f"{di}/RECORD,,")
open(os.path.join(site, di, "RECORD"), "w").write("\n".join(rows) + "\n")
PY
}

# THIRD-PARTY-NOTICES.md sections (after homescoop_notices_begin) for the
# crates the module links (cargo tree of <crate dir>, checked against it),
# the wasix-org Rust standard library and the sysroot's scrt1.o.
homescoop_rust_pyext_notices() {
  local crate="${1:?}" b="${2:?}" wrg
  (cd "$crate" && cargo metadata --locked --format-version 1 --filter-platform "$HOMESCOOP_RUST_PYEXT_TARGET") >"$b/metadata.json"
  (cd "$crate" && cargo tree --locked --target "$HOMESCOOP_RUST_PYEXT_TARGET" -e normal,no-proc-macro --prefix none) >"$b/tree.txt"
  node "$HOMESCOOP_ROOT/scripts/rust-crate-notices.mjs" "$b/metadata.json" "$b/tree.txt" >>"$HOMESCOOP_NOTICES"
  node "$HOMESCOOP_ROOT/scripts/check-rust-notices.mjs" "$HOMESCOOP_NOTICES" "$b/tree.txt" "$crate/Cargo.lock"
  wrg="https://raw.githubusercontent.com/wasix-org/rust/${HOMESCOOP_RUST_PYEXT_WASIX_RUST//+/%2B}"
  homescoop_notice "Rust standard library, wasix-org/rust $HOMESCOOP_RUST_PYEXT_WASIX_RUST (MIT OR Apache-2.0)" \
    "$wrg/COPYRIGHT" 172020dbfd5b53a226dfde77616190a48dcff519b0bc0e6deb91a8450782c4af \
    "$wrg/LICENSE-MIT" b71bd43a069ca0641a9ecfe585ca7b3c53b5cc1608f8b68321168698e28b5ea1 \
    "$wrg/LICENSE-APACHE" 62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a
  homescoop_notice "@ai-ecoverse/wasix-sysroot $HOMESCOOP_WASIX_SYSROOT_VERSION (scrt1.o; wasix-libc, see its LICENSE)" \
    "$WASIXCC_SYSROOT_PREFIX/LICENSE" -
}
