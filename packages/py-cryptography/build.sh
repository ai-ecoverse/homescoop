#!/usr/bin/env bash
# py-cryptography: pyca/cryptography's Rust extension for wasix-python 3.15
# (scripts/rust-pyext.sh), with OpenSSL from wasix-openssl linked in, staged
# as site-packages/cryptography with its dist-info.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
source "$ROOT/scripts/rust-pyext.sh"
homescoop_load_recipe py-cryptography

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="$WORK/py-cryptography-$VERSION"
DL="$B/dl"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export SOURCE_DATE_EPOCH=1764892800 PYTHONHASHSEED=0 ZERO_AR_DATE=1
mkdir -p "$DL"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe py-cryptography --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe py-cryptography
CRYPTO_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$CRYPTO_TGZ"

# --- host CPython 3.15 (cffi's C generator, compileall) ----------------------
HOSTPY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOSTPY" ]] && command -v python3.15 >/dev/null 2>&1; then
  HOSTPY="$(command -v python3.15)"
fi
if [[ -z "$HOSTPY" ]]; then
  HOSTPY="$B/host/bin/python3.15"
  if [[ ! -x "$HOSTPY" ]]; then
    echo "== py-cryptography: host CPython 3.15.0"
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

# --- host cffi 2.1.1 + pycparser 3.12 (build.rs's build_openssl.py) ----------
# _cffi_backend is compiled for the host python against the host's libffi;
# only cffi's C generator runs, nothing of the host build is shipped.
HOSTCFFI="$B/host-cffi"
rm -rf "$HOSTCFFI" && mkdir -p "$HOSTCFFI/src"
fetch_src cffi
CFFI_TGZ="$SRC_FILE"
tar xzf "$CFFI_TGZ" -C "$HOSTCFFI/src"
CFFI_SRC="$HOSTCFFI/src/cffi-2.1.1"
fetch_src pycparser
tar xzf "$SRC_FILE" -C "$HOSTCFFI/src"
cp -R "$CFFI_SRC/src/cffi" "$HOSTCFFI/src/pycparser-3.12/pycparser" "$HOSTCFFI/"
HOST_EXT="$("$HOSTPY" -c 'import sysconfig; print(sysconfig.get_config_var("EXT_SUFFIX"))')"
HOST_INC="$("$HOSTPY" -c 'import sysconfig; print(sysconfig.get_paths()["include"])')"
case "$(uname -s)" in
  Darwin)
    SDK="$(xcrun --show-sdk-path)"
    FFI_CFLAGS=(-I"$SDK/usr/include/ffi") FFI_LIBS=(-lffi) SHARED=(-bundle -undefined dynamic_lookup) ;;
  *)
    if ! pkg-config --exists libffi 2>/dev/null && [[ -n "${CI:-}" ]] && command -v apt-get >/dev/null; then
      sudo apt-get update -qq
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libffi-dev
    fi
    pkg-config --exists libffi || { echo "homescoop py-cryptography: host libffi headers missing (libffi-dev), needed for the host cffi" >&2; exit 1; }
    read -r -a FFI_CFLAGS <<<"$(pkg-config --cflags libffi)"
    read -r -a FFI_LIBS <<<"$(pkg-config --libs libffi)"
    SHARED=(-shared) ;;
esac
(unset CC CFLAGS LDFLAGS; cc -O1 -fPIC "${SHARED[@]}" -I"$HOST_INC" ${FFI_CFLAGS[@]+"${FFI_CFLAGS[@]}"} \
  "$CFFI_SRC/src/c/_cffi_backend.c" ${FFI_LIBS[@]+"${FFI_LIBS[@]}"} -o "$HOSTCFFI/_cffi_backend$HOST_EXT")
PYTHONPATH="$HOSTCFFI" "$HOSTPY" -c 'import cffi, _cffi_backend; assert cffi.__version__ == "2.1.1", cffi.__version__; cffi.FFI()'

# --- WASIX toolchain: wasixcc on the sysroot python.wasm uses, then Rust -----
# wasix-sysroot -40, as wasix-python 3.15.0-5 and later (its scrt1.o is the
# only part linked in; libc comes from python.wasm at dlopen).
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-40
export HOMESCOOP_WASIX_SYSROOT_SHA=9960846c81c78d40a8dfdd58009e66d5ad671a6469947517661b486a4a3d3336
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$B/wasixcc")"
unset CC CXX CFLAGS CXXFLAGS CPPFLAGS LDFLAGS LIBS
homescoop_rust_pyext_toolchain "$B/rust"

fetch_src wasix_python
PYDEV="$B/wasix-python"
rm -rf "$PYDEV" && mkdir -p "$PYDEV"
tar xzf "$SRC_FILE" -C "$PYDEV" package/include package/bin/python.wasm package/package.json
test -f "$PYDEV/package/include/python3.15/Python.h"
PYVER="$(node -p "require('$PYDEV/package/package.json').version")"
PIN="$(node -p "require('$DEST/package.json').dependencies['@ai-ecoverse/wasix-python']")"
[[ "$PIN" == ">=$PYVER <3.15.1" ]] || { echo "homescoop py-cryptography: built against wasix-python $PYVER, package wants $PIN (expected >=$PYVER <3.15.1)" >&2; exit 1; }
# build.rs takes Python.h from PYO3_CROSS_LIB_DIR/../../include/python3.15.
mkdir -p "$PYDEV/package/lib/python3.15"

fetch_src wasix_openssl
OSSL="$B/wasix-openssl"
rm -rf "$OSSL" && mkdir -p "$OSSL"
tar xzf "$SRC_FILE" -C "$OSSL"
OSSL="$OSSL/package"
OSSL_VER="$(node -p "require('$OSSL/package.json').homescoop.upstream")"
test -f "$OSSL/lib-pic/libcrypto.a" && test -f "$OSSL/lib-pic/libssl.a"

# --- the Rust build ----------------------------------------------------------
SRC="$B/cryptography-$VERSION"
rm -rf "$SRC"
tar xzf "$CRYPTO_TGZ" -C "$B"
homescoop_apply_patches "$SRC"
fetch_src target_lexicon
homescoop_rust_pyext_target_lexicon "$SRC" "$SRC_FILE" 0.13.5
homescoop_rust_pyext_pyo3_config "$B/pyo3-wasix-3.15.cfg"
homescoop_rust_pyext_rustflags "$SRC" cryptography
TARGET="$HOMESCOOP_RUST_PYEXT_TARGET"
export CARGO_TARGET_DIR="$SRC/target"
export PYO3_PYTHON="$HOSTPY" PYO3_CROSS_LIB_DIR="$PYDEV/package/lib/python3.15" PYTHONPATH="$HOSTCFFI"
export OPENSSL_STATIC=1 OPENSSL_LIB_DIR="$OSSL/lib-pic" OPENSSL_INCLUDE_DIR="$OSSL/include" OPENSSL_NO_VENDOR=1
CARGO=(cargo)
echo "== py-cryptography: cargo build ($TARGET, wasix-org/rust $HOMESCOOP_RUST_PYEXT_WASIX_RUST, OpenSSL $OSSL_VER)"
(cd "$SRC" && "${CARGO[@]}" build --locked --release --target "$TARGET" --manifest-path src/rust/Cargo.toml)
RUSTSO="$SRC/target/$TARGET/release/libcryptography_rust.so"
test -f "$RUSTSO"
"$WASIXCC_BINARYEN_LOCATION/bin/wasm-opt" -all --metrics "$RUSTSO" -o /dev/null >"$B/metrics.txt" 2>&1
homescoop_rust_pyext_check "$RUSTSO" "$PYDEV/package/bin/python.wasm" _rust --metrics "$B/metrics.txt" \
  --own '^(OPENSSL_|OSSL_|EVP_|SSL_|X509|BIO_|BN_|CRYPTO_|ERR_|RSA_|EC_|ECDSA_|DH_|DSA_|PEM_|ASN1_|PKCS|OBJ_|HMAC|RAND_|i2d_|d2i_)'

# --- stage -------------------------------------------------------------------
SITE="$DEST/lib/python3.15/site-packages"
rm -rf "$DEST/lib"
mkdir -p "$SITE"
cp -R "$SRC/src/cryptography" "$SITE/cryptography"
find "$SITE/cryptography" -name '__pycache__' -prune -exec rm -rf {} +
SO="_rust.cpython-315-wasm32-wasix.so"
cp "$RUSTSO" "$SITE/cryptography/hazmat/bindings/$SO"
chmod 755 "$SITE/cryptography/hazmat/bindings/$SO"
# No path of this build in the module. The prebuilt wasix-org std carries
# its own CI's cargo paths in panic locations (/home/runner/.cargo/... for
# the Linux toolchain, /Users/runner/... for macOS), which can look like
# ours on a runner; those strings are the toolchain's fixed bytes, so a
# string that is also in the target's std rlibs is not a leak.
LEAKS=(-e "$B" -e "$(cd "$B" && pwd -P)" -e "$HOME" -e "${CARGO_HOME:-$HOME/.cargo}")
strings "$HOMESCOOP_RUST_PYEXT_WR/lib/rustlib/$TARGET/lib/"*.rlib | LC_ALL=C sort -u >"$B/std-strings.txt"
strings "$SITE/cryptography/hazmat/bindings/$SO" | grep -F "${LEAKS[@]}" | LC_ALL=C sort -u >"$B/leaks.txt" || true
LC_ALL=C comm -23 "$B/leaks.txt" "$B/std-strings.txt" >"$B/leaks-own.txt"
if [[ -s "$B/leaks-own.txt" ]]; then
  echo "homescoop py-cryptography: a build path leaked into $SO" >&2
  head "$B/leaks-own.txt" >&2
  exit 1
fi
echo "== py-cryptography: no build path in $SO ($(wc -l <"$B/leaks.txt" | tr -d ' ') toolchain std paths, all in the prebuilt std)"
DI="$SITE/cryptography-$VERSION.dist-info"
mkdir -p "$DI/licenses"
cp "$SRC/PKG-INFO" "$DI/METADATA"
cp "$SRC/LICENSE" "$SRC/LICENSE.APACHE" "$SRC/LICENSE.BSD" "$DI/licenses/"
printf 'Wheel-Version: 1.0\nGenerator: homescoop (packages/py-cryptography/build.sh)\nRoot-Is-Purelib: false\nTag: cp315-cp315-wasix_wasm32\n\n' >"$DI/WHEEL"
printf 'cryptography\n' >"$DI/top_level.txt"
"$HOSTPY" - "$SITE" "cryptography-$VERSION.dist-info" <<'PY'
import base64, hashlib, os, sys
site, di = sys.argv[1], sys.argv[2]
rows = []
for top in ("cryptography", di):
    for d, _, files in sorted(os.walk(os.path.join(site, top))):
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
homescoop_stage_licenses "$SRC/LICENSE" "$SRC/LICENSE.APACHE" "$SRC/LICENSE.BSD"

# --- notices -----------------------------------------------------------------
homescoop_notices_begin "cryptography/hazmat/bindings/$SO (pyca/cryptography $VERSION, Apache-2.0 OR BSD-3-Clause, see LICENSE) statically links these crates, OpenSSL $OSSL_VER (from @ai-ecoverse/wasix-openssl), C code that cffi 2.1.1 generated, the wasix-org Rust standard library ($HOMESCOOP_RUST_PYEXT_WASIX_RUST) and scrt1.o of @ai-ecoverse/wasix-sysroot $HOMESCOOP_WASIX_SYSROOT_VERSION."
META="$B/metadata.json"
TREE="$B/tree.txt"
(cd "$SRC" && "${CARGO[@]}" metadata --locked --format-version 1 --filter-platform "$TARGET" --manifest-path src/rust/Cargo.toml) >"$META"
(cd "$SRC" && "${CARGO[@]}" tree --locked --target "$TARGET" -e normal,no-proc-macro --prefix none --manifest-path src/rust/Cargo.toml -p cryptography-rust) >"$TREE"
node "$ROOT/scripts/rust-crate-notices.mjs" "$META" "$TREE" >>"$HOMESCOOP_NOTICES"
node "$ROOT/scripts/check-rust-notices.mjs" "$HOMESCOOP_NOTICES" "$TREE" "$SRC/Cargo.lock"
homescoop_notice "OpenSSL $OSSL_VER (Apache-2.0)" "$OSSL/LICENSE" -
homescoop_notice "cffi 2.1.1 (MIT-0): _cffi_include.h and parse_c_type.h, which the generated _openssl.c includes" "$CFFI_SRC/LICENSE" -
WRG="https://raw.githubusercontent.com/wasix-org/rust/${HOMESCOOP_RUST_PYEXT_WASIX_RUST//+/%2B}"
homescoop_notice "Rust standard library, wasix-org/rust $HOMESCOOP_RUST_PYEXT_WASIX_RUST (MIT OR Apache-2.0)" \
  "$WRG/COPYRIGHT" 172020dbfd5b53a226dfde77616190a48dcff519b0bc0e6deb91a8450782c4af \
  "$WRG/LICENSE-MIT" b71bd43a069ca0641a9ecfe585ca7b3c53b5cc1608f8b68321168698e28b5ea1 \
  "$WRG/LICENSE-APACHE" 62c7a1e35f56406896d7aa7ca52d0cc0d272ac022b5d2796e7d6905db8a3636a
homescoop_notice "@ai-ecoverse/wasix-sysroot $HOMESCOOP_WASIX_SYSROOT_VERSION (scrt1.o; wasix-libc, see its LICENSE)" \
  "$WASIXCC_SYSROOT_PREFIX/LICENSE" -
homescoop_compile_pyc "$SITE"
echo "== py-cryptography: staged $(du -sh "$DEST" | awk '{print $1}')"
