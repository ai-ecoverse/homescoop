#!/usr/bin/env bash
# py-cffi: cffi's _cffi_backend as a wasix-python side module, cffi's Python
# package, and the self-test fixtures (recipe.yaml notes, package/README.md).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
source "$ROOT/scripts/cffi-wasix.sh"
homescoop_load_recipe py-cffi

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="$WORK/py-cffi-$VERSION"
DL="$B/dl"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export SOURCE_DATE_EPOCH=1782899241 PYTHONHASHSEED=0 ZERO_AR_DATE=1
mkdir -p "$DL"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe py-cffi --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe py-cffi
CFFI_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$CFFI_TGZ"

# Host CPython 3.15: compileall for the shipped .pyc, and the codegen python.
HOSTPY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOSTPY" ]] && command -v python3.15 >/dev/null 2>&1; then
  HOSTPY="$(command -v python3.15)"
fi
if [[ -z "$HOSTPY" ]]; then
  HOSTPY="$B/host/bin/python3.15"
  if [[ ! -x "$HOSTPY" ]]; then
    echo "== py-cffi: host CPython 3.15.0 (compileall)"
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

# wasix-sysroot -38, as wasix-python 3.15.0-1 (the cp315 wave, #761).
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-38
export HOMESCOOP_WASIX_SYSROOT_SHA=1fb57c95d84e7b33a5a535561a0d536c943c40fefd70991f9570db8e27994574
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$B/wasixcc")"
export WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes WASIXCC_RUN_WASM_OPT=no
unset CC CXX CFLAGS CXXFLAGS CPPFLAGS LDFLAGS LIBS WASIXCC_MODULE_KIND

fetch_src wasix_python
PYDEV="$B/wasix-python"
rm -rf "$PYDEV" && mkdir -p "$PYDEV"
tar xzf "$SRC_FILE" -C "$PYDEV" package/include package/package.json
PYINC="$PYDEV/package/include/python3.15"
test -f "$PYINC/Python.h"
PYVER="$(node -p "require('$PYDEV/package/package.json').version")"
PIN="$(node -p "require('$DEST/package.json').dependencies['@ai-ecoverse/wasix-python']")"
# The package takes any wasix-python 3.15.0 from the one whose headers it's built against (homescoop#702).
[[ "$PIN" == ">=$PYVER <3.15.1" ]] || { echo "homescoop py-cffi: headers from wasix-python $PYVER, package wants $PIN (expected >=$PYVER <3.15.1)" >&2; exit 1; }

# libffi's headers, as wasix-python's libffi configure writes them for
# wasm32-unknown-wasix: ffi.h from include/ffi.h.in and src/wasm32/ffitarget.h.
# No libffi is compiled: python.wasm exports the whole libffi API.
fetch_src libffi
FFISRC="$B/libffi-src"
FFIINC="$B/libffi-include"
rm -rf "$FFISRC" "$FFIINC" && mkdir -p "$FFISRC" "$FFIINC"
tar xzf "$SRC_FILE" -C "$FFISRC" --strip-components=1
FFI_VER="$(sed -n 's/^FFI_VERSION_STRING="\([0-9.]*\)"$/\1/p' "$FFISRC/configure.ac")"
FFI_NUM="$(sed -n 's/^FFI_VERSION_NUMBER=\([0-9]*\)$/\1/p' "$FFISRC/configure.ac")"
[[ -n "$FFI_VER" && -n "$FFI_NUM" ]] || { echo "homescoop py-cffi: no FFI_VERSION_STRING/NUMBER in libffi's configure.ac" >&2; exit 1; }
grep -q '^  wasm32-\*-\*)$' "$FFISRC/configure.host" && grep -q 'TARGET=wasm32; TARGETDIR=wasm32' "$FFISRC/configure.host" \
  || { echo "homescoop py-cffi: libffi's configure.host no longer maps wasm32 to TARGET=wasm32" >&2; exit 1; }
# wasm32: long double (16 bytes) is bigger than double, no trampoline table.
sed -e "s/@VERSION@/$FFI_VER/g" -e 's/@TARGET@/wasm32/g' -e 's/@HAVE_LONG_DOUBLE@/1/g' \
  -e 's/@FFI_EXEC_TRAMPOLINE_TABLE@/0/g' -e "s/@FFI_VERSION_STRING@/$FFI_VER/g" -e "s/@FFI_VERSION_NUMBER@/$FFI_NUM/g" \
  "$FFISRC/include/ffi.h.in" >"$FFIINC/ffi.h"
cp "$FFISRC/src/wasm32/ffitarget.h" "$FFIINC/ffitarget.h"
! grep -n '@[A-Z_]*@' "$FFIINC/ffi.h" || { echo "homescoop py-cffi: ffi.h.in has a placeholder this build doesn't fill" >&2; exit 1; }

SRC="$B/cffi-$VERSION"
rm -rf "$SRC"
tar xzf "$CFFI_TGZ" -C "$B"
homescoop_apply_patches "$SRC"

# setup.py's choices for a POSIX target: FFI_BUILDING, HAVE_SYNC_SYNCHRONIZE
# (-matomics). No USE__THREAD: cffi keeps errno in its pthread-key TLS block,
# so the side module has no __thread data of its own.
OBJ="$B/obj"
rm -rf "$OBJ" && mkdir -p "$OBJ"
EXT=".cpython-315-wasm32-wasix.so"
echo "== py-cffi: wasixcc src/c/_cffi_backend.c"
wasixcc -O2 -DNDEBUG -fPIC -fvisibility=default -matomics -mbulk-memory -mmutable-globals -pthread \
  -DFFI_BUILDING=1 -DHAVE_SYNC_SYNCHRONIZE -I"$PYINC" -I"$FFIINC" -ffile-prefix-map="$B"=. \
  -c "$SRC/src/c/_cffi_backend.c" -o "$OBJ/_cffi_backend.o"
WASIXCC_MODULE_KIND=shared-library wasixcc -shared -fPIC -fvisibility=default -Wl,--allow-undefined \
  -o "$OBJ/_cffi_backend$EXT" "$OBJ/_cffi_backend.o"
# One libffi: every ffi_* symbol is an import from python.wasm, none defined here.
node "$PKG/test/side-imports.mjs" "$OBJ/_cffi_backend$EXT"

SITE="$DEST/lib/python3.15/site-packages"
rm -rf "$DEST/lib" "$DEST/share"
mkdir -p "$SITE/cffi"
cp "$OBJ/_cffi_backend$EXT" "$SITE/_cffi_backend$EXT"
chmod 755 "$SITE/_cffi_backend$EXT"
# The cffi package as the wheel has it: its .py and the .h the recompiler inlines.
(cd "$SRC/src/cffi" && for f in *.py *.h; do cp "$f" "$SITE/cffi/$f"; done)
DI="$SITE/cffi-$VERSION.dist-info"
mkdir -p "$DI/licenses"
cp "$SRC/PKG-INFO" "$DI/METADATA"
cp "$SRC/LICENSE" "$DI/licenses/LICENSE"
printf 'Wheel-Version: 1.0\nGenerator: homescoop (packages/py-cffi/build.sh)\nRoot-Is-Purelib: false\nTag: cp315-cp315-wasix_wasm32\n\n' >"$DI/WHEEL"
printf '_cffi_backend\ncffi\n' >"$DI/top_level.txt"
# pyproject.toml's scripts and entry points, as the wheel's entry_points.txt has them.
grep -q '^cffi_modules = "cffi.setuptools_ext:cffi_modules"$' "$SRC/pyproject.toml" \
  && grep -q '^cffi-gen-src = "cffi._cffi_gen_src:run"$' "$SRC/pyproject.toml" \
  || { echo "homescoop py-cffi: pyproject.toml's entry points changed" >&2; exit 1; }
printf '[console_scripts]\ncffi-gen-src = cffi._cffi_gen_src:run\n\n[distutils.setup_keywords]\ncffi_modules = cffi.setuptools_ext:cffi_modules\n' >"$DI/entry_points.txt"
"$HOSTPY" - "$SITE" "cffi-$VERSION.dist-info" "_cffi_backend$EXT" <<'PY'
import base64, hashlib, os, sys
site, di, so = sys.argv[1], sys.argv[2], sys.argv[3]
rows = []
paths = [os.path.join(site, so)]
for top in ("cffi", di):
    for d, _, files in sorted(os.walk(os.path.join(site, top))):
        paths += [os.path.join(d, f) for f in sorted(files)]
for p in paths:
    rel = os.path.relpath(p, site)
    if rel == f"{di}/RECORD" or "__pycache__" in rel:
        continue
    data = open(p, "rb").read()
    h = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
    rows.append(f"{rel},sha256={h},{len(data)}")
rows.append(f"{di}/RECORD,,")
open(os.path.join(site, di, "RECORD"), "w").write("\n".join(rows) + "\n")
PY

# The cert fixtures (share/py-cffi/selftest, not on sys.path):
#  - libcffi_selftest.so, a plain C side module for ABI mode (ffi.dlopen);
#  - _cffi_selftest, an API-mode extension built the way a downstream recipe
#    builds one: cffi's ffibuilder on the host, then wasixcc (cffi-wasix.sh).
ST="$DEST/share/py-cffi/selftest"
mkdir -p "$ST"
echo "== py-cffi: selftest fixtures"
wasixcc -O2 -fPIC -fvisibility=default -matomics -mbulk-memory -mmutable-globals -pthread -ffile-prefix-map="$PKG"=. \
  -c "$PKG/selftest/libcffi_selftest.c" -o "$OBJ/libcffi_selftest.o"
WASIXCC_MODULE_KIND=shared-library wasixcc -shared -fPIC -fvisibility=default -Wl,--allow-undefined \
  -o "$ST/libcffi_selftest.so" "$OBJ/libcffi_selftest.o"
chmod 755 "$ST/libcffi_selftest.so"
export HOMESCOOP_CFFI_HOST_PY="$HOSTPY"
homescoop_cffi_host "$B/cffi-host"
[[ "$CFFI_HOST_VERSION" == "$VERSION" ]] || { echo "homescoop py-cffi: host cffi $CFFI_HOST_VERSION is not $VERSION" >&2; exit 1; }
GEN="$B/selftest-gen"
rm -rf "$GEN" && mkdir -p "$GEN"
homescoop_cffi_emit "$PKG/selftest/build_selftest.py:ffibuilder" "$GEN/_cffi_selftest.c"
CFFI_WASIX_PYINC="$PYINC" homescoop_cffi_ext "$GEN/_cffi_selftest$EXT" "$GEN/_cffi_selftest.c"
cp "$GEN/_cffi_selftest$EXT" "$ST/_cffi_selftest$EXT"
cp "$PKG/selftest/libcffi_selftest.c" "$PKG/selftest/cdef.h" "$PKG/selftest/build_selftest.py" "$ST/"
chmod 644 "$ST"/*.c "$ST"/*.h "$ST"/*.py

cp "$SRC/LICENSE" "$DEST/LICENSE"
WORK="$B" homescoop_notices_begin "_cffi_backend is compiled against the headers (ffi.h, ffitarget.h) of the libffi in @ai-ecoverse/wasix-python (wasix-org/libffi 09cbf7d), and calls that libffi in python.wasm; it links none of its own. cffi's own licence is LICENSE."
WORK="$B" homescoop_notice "libffi $FFI_VER (wasix-org 09cbf7d) headers (MIT)" "$FFISRC/LICENSE" -
homescoop_compile_pyc "$SITE"
node "$ROOT/packages/py-kiwisolver/test/wasm-call-signatures.mjs" "$SITE/_cffi_backend$EXT" "$ST/_cffi_selftest$EXT"
echo "== py-cffi: staged $(du -sh "$DEST" | awk '{print $1}')"
