#!/usr/bin/env bash
# py-bcrypt: pyca/bcrypt's Rust extension for wasix-python 3.15
# (scripts/rust-pyext.sh), staged as site-packages/bcrypt with its dist-info.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
source "$ROOT/scripts/rust-pyext.sh"
homescoop_load_recipe py-bcrypt

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="$WORK/py-bcrypt-$VERSION"
DL="$B/dl"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export SOURCE_DATE_EPOCH=1764892800 PYTHONHASHSEED=0 ZERO_AR_DATE=1
mkdir -p "$DL"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe py-bcrypt --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe py-bcrypt
BCRYPT_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$BCRYPT_TGZ"

# --- host CPython 3.15 (compileall) -----------------------------------------
HOSTPY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOSTPY" ]] && command -v python3.15 >/dev/null 2>&1; then
  HOSTPY="$(command -v python3.15)"
fi
if [[ -z "$HOSTPY" ]]; then
  HOSTPY="$B/host/bin/python3.15"
  if [[ ! -x "$HOSTPY" ]]; then
    echo "== py-bcrypt: host CPython 3.15.0"
    fetch_src cpython
    rm -rf "$B/host-src" && mkdir -p "$B/host-src"
    tar xzf "$SRC_FILE" -C "$B/host-src" --strip-components=1
    (
      cd "$B/host-src"
      unset CC CXX CFLAGS CXXFLAGS LDFLAGS CPPFLAGS
      ./configure --prefix="$B/host" --without-ensurepip --disable-test-modules \
        py_cv_module__ssl=n/a py_cv_module__hashlib=n/a >"$B/host-configure.log" 2>&1
      make -j"$JOBS" >"$B/host-make.log" 2>&1
      make install >"$B/host-install.log" 2>&1
    ) || { tail -40 "$B"/host-*.log >&2; exit 1; }
  fi
fi
"$HOSTPY" -c 'import sys; assert sys.version_info[:2] == (3, 15), sys.version'
export WASIX_PYTHON_HOST_PY="$HOSTPY"

# --- WASIX toolchain (as py-cryptography) ------------------------------------
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-40
export HOMESCOOP_WASIX_SYSROOT_SHA=9960846c81c78d40a8dfdd58009e66d5ad671a6469947517661b486a4a3d3336
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$B/wasixcc")"
unset CC CXX CFLAGS CXXFLAGS CPPFLAGS LDFLAGS LIBS
homescoop_rust_pyext_toolchain "$B/rust"

fetch_src wasix_python
PYDEV="$B/wasix-python"
rm -rf "$PYDEV" && mkdir -p "$PYDEV"
tar xzf "$SRC_FILE" -C "$PYDEV" package/bin/python.wasm package/package.json
PYVER="$(node -p "require('$PYDEV/package/package.json').version")"
PIN="$(node -p "require('$DEST/package.json').dependencies['@ai-ecoverse/wasix-python']")"
[[ "$PIN" == ">=$PYVER <3.15.1" ]] || { echo "homescoop py-bcrypt: built against wasix-python $PYVER, package wants $PIN (expected >=$PYVER <3.15.1)" >&2; exit 1; }

# --- the Rust build ----------------------------------------------------------
SRC="$B/bcrypt-$VERSION"
rm -rf "$SRC"
tar xzf "$BCRYPT_TGZ" -C "$B"
homescoop_apply_patches "$SRC"
CRATE="$SRC/src/_bcrypt"
fetch_src target_lexicon
homescoop_rust_pyext_target_lexicon "$CRATE" "$SRC_FILE" 0.13.3
# getrandom 0.3.3, the version src/_bcrypt/Cargo.lock locks (its checksum).
GETRANDOM="$DL/getrandom-0.3.3.crate"
homescoop_fetch https://static.crates.io/crates/getrandom/getrandom-0.3.3.crate \
  26145e563e54f2cadc477553f1ec5ee650b00862f0a58bcd12cbdc5f0ea2d2f4 "$GETRANDOM"
homescoop_rust_pyext_patch_crate "$CRATE" "$GETRANDOM" getrandom 0.3.3
homescoop_rust_pyext_pyo3_config "$B/pyo3-wasix-3.15.cfg"
homescoop_rust_pyext_rustflags "$SRC" bcrypt
TARGET="$HOMESCOOP_RUST_PYEXT_TARGET"
export CARGO_TARGET_DIR="$CRATE/target"
CARGO=(cargo)
echo "== py-bcrypt: cargo build ($TARGET, wasix-org/rust $HOMESCOOP_RUST_PYEXT_WASIX_RUST)"
(cd "$CRATE" && "${CARGO[@]}" build --locked --release --target "$TARGET")
RUSTSO="$CRATE/target/$TARGET/release/libbcrypt_rust.so"
test -f "$RUSTSO"
"$WASIXCC_BINARYEN_LOCATION/bin/wasm-opt" -all --metrics "$RUSTSO" -o /dev/null >"$B/metrics.txt" 2>&1
homescoop_rust_pyext_check "$RUSTSO" "$PYDEV/package/bin/python.wasm" _bcrypt --metrics "$B/metrics.txt"

# --- stage -------------------------------------------------------------------
SITE="$DEST/lib/python3.15/site-packages"
rm -rf "$DEST/lib"
mkdir -p "$SITE"
cp -R "$SRC/src/bcrypt" "$SITE/bcrypt"
find "$SITE/bcrypt" -name '__pycache__' -prune -exec rm -rf {} +
SO="_bcrypt.cpython-315-wasm32-wasix.so"
cp "$RUSTSO" "$SITE/bcrypt/$SO"
chmod 755 "$SITE/bcrypt/$SO"
homescoop_rust_pyext_no_build_paths "$B" "$SITE/bcrypt/$SO"
DI="$SITE/bcrypt-$VERSION.dist-info"
mkdir -p "$DI/licenses"
cp "$SRC/PKG-INFO" "$DI/METADATA"
cp "$SRC/LICENSE" "$DI/licenses/"
printf 'Wheel-Version: 1.0\nGenerator: homescoop (packages/py-bcrypt/build.sh)\nRoot-Is-Purelib: false\nTag: cp315-cp315-wasix_wasm32\n\n' >"$DI/WHEEL"
printf 'bcrypt\n' >"$DI/top_level.txt"
homescoop_rust_pyext_record "$HOSTPY" "$SITE" bcrypt "bcrypt-$VERSION.dist-info"
homescoop_stage_license "$SRC/LICENSE"

# --- notices -----------------------------------------------------------------
homescoop_notices_begin "bcrypt/$SO (pyca/bcrypt $VERSION, Apache-2.0, see LICENSE) statically links these crates (getrandom 0.3.3 with homescoop's scripts/rust-pyext/getrandom-dl.patch), the wasix-org Rust standard library ($HOMESCOOP_RUST_PYEXT_WASIX_RUST) and scrt1.o of @ai-ecoverse/wasix-sysroot $HOMESCOOP_WASIX_SYSROOT_VERSION."
homescoop_rust_pyext_notices "$CRATE" "$B"
homescoop_compile_pyc "$SITE"
echo "== py-bcrypt: staged $(du -sh "$DEST" | awk '{print $1}')"
