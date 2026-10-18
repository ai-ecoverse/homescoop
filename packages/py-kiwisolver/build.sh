#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe py-kiwisolver

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="$WORK/py-kiwisolver-$VERSION"
DL="$B/dl"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export SOURCE_DATE_EPOCH=1764892800 PYTHONHASHSEED=0 ZERO_AR_DATE=1
mkdir -p "$DL"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe py-kiwisolver --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe py-kiwisolver
KW_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$KW_TGZ"

HOSTPY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOSTPY" ]] && command -v python3.14 >/dev/null 2>&1; then
  HOSTPY="$(command -v python3.14)"
fi
if [[ -z "$HOSTPY" ]]; then
  HOSTPY="$B/host/bin/python3.14"
  if [[ ! -x "$HOSTPY" ]]; then
    echo "== py-kiwisolver: host CPython 3.14.2 (compileall)"
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
"$HOSTPY" -c 'import sys; assert sys.version_info[:2] == (3, 14), sys.version'
export WASIX_PYTHON_HOST_PY="$HOSTPY"

eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$B/wasixcc")"
export WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes WASIXCC_MODULE_KIND=shared-library WASIXCC_RUN_WASM_OPT=no
unset CC CXX CFLAGS CXXFLAGS CPPFLAGS LDFLAGS LIBS

fetch_src wasix_python
PYDEV="$B/wasix-python"
rm -rf "$PYDEV" && mkdir -p "$PYDEV"
tar xzf "$SRC_FILE" -C "$PYDEV" package/include package/package.json
PYINC="$PYDEV/package/include/python3.14"
test -f "$PYINC/Python.h"
PYVER="$(node -p "require('$PYDEV/package/package.json').version")"
PIN="$(node -p "require('$DEST/package.json').dependencies['@ai-ecoverse/wasix-python']")"
# The package takes any wasix-python 3.14.2 from the one whose headers it's built against (homescoop#702).
[[ "$PIN" == ">=$PYVER <3.14.3" ]] || { echo "homescoop py-kiwisolver: headers from wasix-python $PYVER, package wants $PIN (expected >=$PYVER <3.14.3)" >&2; exit 1; }

fetch_src cxxrt
CXXRT="$B/cxxrt"
rm -rf "$CXXRT" && mkdir -p "$CXXRT"
tar xzf "$SRC_FILE" -C "$CXXRT" wasix-sysroot-ehpic/sysroot/include/c++
CXXINC="$CXXRT/wasix-sysroot-ehpic/sysroot/include/c++/v1"
test -f "$CXXINC/vector"

fetch_src cppy
CPPY="$B/cppy"
rm -rf "$CPPY" && mkdir -p "$CPPY"
tar xzf "$SRC_FILE" -C "$CPPY" --strip-components=1
test -f "$CPPY/cppy/include/cppy/cppy.h"

SRC="$B/kiwisolver-$VERSION"
rm -rf "$SRC"
tar xzf "$KW_TGZ" -C "$B"
homescoop_apply_patches "$SRC"

OBJ="$B/obj"
rm -rf "$OBJ" && mkdir -p "$OBJ"
CXXFLAGS=(-O2 -DNDEBUG -fPIC -fvisibility=default -std=c++17 -matomics -mbulk-memory -mmutable-globals -pthread
  -nostdinc++ -isystem "$CXXINC" -I"$PYINC" -I"$CPPY/cppy/include" -I"$SRC" -ffile-prefix-map="$B"=.)
for f in kiwisolver constraint expression solver strength term variable; do
  echo "== py-kiwisolver: wasixcc++ py/src/$f.cpp"
  wasixcc++ "${CXXFLAGS[@]}" -c "$SRC/py/src/$f.cpp" -o "$OBJ/$f.o"
done
SO="_cext.cpython-314-wasm32-wasix.so"
wasixcc++ -shared -fPIC -fvisibility=default -Wl,--allow-undefined -o "$OBJ/$SO" "$OBJ"/*.o

SITE="$DEST/lib/python3.14/site-packages"
rm -rf "$DEST/lib"
mkdir -p "$SITE/kiwisolver"
for f in __init__.py _cext.pyi exceptions.py py.typed; do
  cp "$SRC/py/kiwisolver/$f" "$SITE/kiwisolver/$f"
done
cp "$OBJ/$SO" "$SITE/kiwisolver/$SO"
chmod 755 "$SITE/kiwisolver/$SO"
DI="$SITE/kiwisolver-$VERSION.dist-info"
mkdir -p "$DI/licenses"
cp "$SRC/PKG-INFO" "$DI/METADATA"
cp "$SRC/LICENSE" "$DI/licenses/LICENSE"
printf 'Wheel-Version: 1.0\nGenerator: homescoop (packages/py-kiwisolver/build.sh)\nRoot-Is-Purelib: false\nTag: cp314-cp314-wasix_wasm32\n\n' >"$DI/WHEEL"
printf 'kiwisolver\n' >"$DI/top_level.txt"
"$HOSTPY" - "$SITE" "kiwisolver-$VERSION.dist-info" <<'PY'
import base64, hashlib, os, sys
site, di = sys.argv[1], sys.argv[2]
rows = []
for top in ("kiwisolver", di):
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
cp "$SRC/LICENSE" "$DEST/LICENSE"
homescoop_compile_pyc "$SITE"
node "$PKG/test/wasm-call-signatures.mjs" "$SITE/kiwisolver/$SO"
echo "== py-kiwisolver: staged $(du -sh "$DEST" | awk '{print $1}')"
