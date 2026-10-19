#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe py-pillow

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="$WORK/py-pillow-$VERSION"
DL="$B/dl"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export SOURCE_DATE_EPOCH=1782899241 PYTHONHASHSEED=0 ZERO_AR_DATE=1
mkdir -p "$DL"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe py-pillow --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe py-pillow
PIL_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$PIL_TGZ"

HOSTPY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOSTPY" ]] && command -v python3.15 >/dev/null 2>&1; then
  HOSTPY="$(command -v python3.15)"
fi
if [[ -z "$HOSTPY" ]]; then
  HOSTPY="$B/host/bin/python3.15"
  if [[ ! -x "$HOSTPY" ]]; then
    echo "== py-pillow: host CPython 3.15.0 (compileall)"
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
FLOOR="$(node --input-type=module -e "import { pythonRange } from '$ROOT/scripts/check-exact-pins.mjs'; import { readFileSync } from 'node:fs'; const r = pythonRange(JSON.parse(readFileSync('$DEST/package.json', 'utf8')).dependencies['@ai-ecoverse/wasix-python']); console.log(r ? r.floor : '')")"
[[ "$PYVER" == "$FLOOR" ]] || { echo "homescoop py-pillow: headers from wasix-python $PYVER, but the package's range floor is '$FLOOR'" >&2; exit 1; }

fetch_src wasix_zlib
ZDEV="$B/wasix-zlib"
rm -rf "$ZDEV" && mkdir -p "$ZDEV"
tar xzf "$SRC_FILE" -C "$ZDEV" package/include
ZINC="$ZDEV/package/include"
test -f "$ZINC/zlib.h"

DEPS="$B/deps"
rm -rf "$DEPS" && mkdir -p "$DEPS"
CMAKE_WASIX=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_SYSTEM_NAME=WASI -DCMAKE_SYSTEM_PROCESSOR=wasm32
  -DCMAKE_C_COMPILER=wasixcc -DCMAKE_AR="$(command -v wasixar)" -DCMAKE_RANLIB="$(command -v wasixranlib)"
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_INSTALL_PREFIX="$DEPS" -DCMAKE_INSTALL_LIBDIR=lib
  -DCMAKE_C_FLAGS="-O2 -fPIC -fvisibility=default -matomics -mbulk-memory -mmutable-globals -pthread -ffile-prefix-map=$B=."
  -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY)

echo "== py-pillow: libjpeg-turbo 3.1.2 (static, PIC)"
fetch_src libjpeg_turbo
JT="$B/libjpeg-turbo"
rm -rf "$JT" && mkdir -p "$JT/src"
tar xzf "$SRC_FILE" -C "$JT/src" --strip-components=1
cmake -S "$JT/src" -B "$JT/build" "${CMAKE_WASIX[@]}" -DENABLE_SHARED=OFF -DENABLE_STATIC=ON \
  -DWITH_SIMD=OFF -DWITH_TURBOJPEG=OFF -DWITH_TOOLS=OFF -DWITH_TESTS=OFF -DWITH_JAVA=OFF >"$B/jpeg-cmake.log" 2>&1 \
  || { tail -60 "$B/jpeg-cmake.log" >&2; exit 1; }
cmake --build "$JT/build" -j"$JOBS" >"$B/jpeg-build.log" 2>&1 || { tail -60 "$B/jpeg-build.log" >&2; exit 1; }
cmake --install "$JT/build" >"$B/jpeg-install.log" 2>&1
test -f "$DEPS/lib/libjpeg.a"

echo "== py-pillow: FreeType 2.13.3 (static, PIC; no zlib/bzip2/png/harfbuzz/brotli)"
fetch_src freetype
FT="$B/freetype"
rm -rf "$FT" && mkdir -p "$FT/src"
tar xzf "$SRC_FILE" -C "$FT/src" --strip-components=1
cmake -S "$FT/src" -B "$FT/build" "${CMAKE_WASIX[@]}" -DBUILD_SHARED_LIBS=OFF \
  -DFT_DISABLE_ZLIB=ON -DFT_DISABLE_BZIP2=ON -DFT_DISABLE_PNG=ON -DFT_DISABLE_HARFBUZZ=ON -DFT_DISABLE_BROTLI=ON \
  >"$B/ft-cmake.log" 2>&1 || { tail -60 "$B/ft-cmake.log" >&2; exit 1; }
cmake --build "$FT/build" -j"$JOBS" >"$B/ft-build.log" 2>&1 || { tail -60 "$B/ft-build.log" >&2; exit 1; }
cmake --install "$FT/build" >"$B/ft-install.log" 2>&1
test -f "$DEPS/lib/libfreetype.a"

SRC="$B/pillow-$VERSION"
rm -rf "$SRC"
tar xzf "$PIL_TGZ" -C "$B"
homescoop_apply_patches "$SRC"

LIB_IMAGING="$("$HOSTPY" - "$SRC/setup.py" <<'PY'
import ast, sys
tree = ast.parse(open(sys.argv[1]).read())
for node in tree.body:
    if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) == "_LIB_IMAGING":
        print(" ".join(ast.literal_eval(node.value)))
PY
)"
[[ -n "$LIB_IMAGING" ]] || { echo "homescoop py-pillow: no _LIB_IMAGING in setup.py" >&2; exit 1; }

OBJ="$B/obj"
rm -rf "$OBJ" && mkdir -p "$OBJ"
CFLAGS_PIL=(-O2 -DNDEBUG -fPIC -fvisibility=default -matomics -mbulk-memory -mmutable-globals -pthread
  -I"$PYINC" -I"$SRC/src/libImaging" -I"$SRC/src" -I"$DEPS/include" -I"$DEPS/include/freetype2" -I"$ZINC"
  -DHAVE_LIBJPEG -DHAVE_LIBZ -DPILLOW_VERSION="\"$VERSION\"" -ffile-prefix-map="$B"=.)
cc_pil() {
  local src=$1 out
  out="$OBJ/$(echo "${src#"$SRC"/}" | tr / _).o"
  wasixcc "${CFLAGS_PIL[@]}" -c "$src" -o "$out"
  printf '%s\n' "$out"
}
IMAGING_OBJS=()
echo "== py-pillow: wasixcc src/libImaging (${LIB_IMAGING//[^ ]/})"
for f in $LIB_IMAGING; do IMAGING_OBJS+=("$(cc_pil "$SRC/src/libImaging/$f.c")"); done
for f in _imaging decode encode map display outline path; do IMAGING_OBJS+=("$(cc_pil "$SRC/src/$f.c")"); done
MODE_OBJ="$(cc_pil "$SRC/src/libImaging/Mode.c")"
FT_OBJ="$(cc_pil "$SRC/src/_imagingft.c")"
MATH_OBJ="$(cc_pil "$SRC/src/_imagingmath.c")"
MORPH_OBJ="$(cc_pil "$SRC/src/_imagingmorph.c")"

SITE="$DEST/lib/python3.15/site-packages"
rm -rf "$DEST/lib"
mkdir -p "$SITE/PIL"
EXT=".cpython-315-wasm32-wasix.so"
link_so() {
  local out=$1; shift
  WASIXCC_MODULE_KIND=shared-library wasixcc -shared -fPIC -fvisibility=default -Wl,--allow-undefined -o "$SITE/PIL/$out$EXT" "$@"
  chmod 755 "$SITE/PIL/$out$EXT"
}
echo "== py-pillow: link the side modules"
link_so _imaging "${IMAGING_OBJS[@]}" "$MODE_OBJ" "$DEPS/lib/libjpeg.a"
link_so _imagingft "$FT_OBJ" "$MODE_OBJ" "$DEPS/lib/libfreetype.a"
link_so _imagingmath "$MATH_OBJ" "$MODE_OBJ"
link_so _imagingmorph "$MORPH_OBJ" "$MODE_OBJ"

cp "$SRC"/src/PIL/*.py "$SRC"/src/PIL/*.pyi "$SITE/PIL/" 2>/dev/null || cp "$SRC"/src/PIL/*.py "$SITE/PIL/"
[[ -f "$SRC/src/PIL/py.typed" ]] && cp "$SRC/src/PIL/py.typed" "$SITE/PIL/"
DI="$SITE/pillow-$VERSION.dist-info"
mkdir -p "$DI/licenses"
cp "$SRC/PKG-INFO" "$DI/METADATA"
cp "$SRC/LICENSE" "$DI/licenses/LICENSE"
printf 'Wheel-Version: 1.0\nGenerator: homescoop (packages/py-pillow/build.sh)\nRoot-Is-Purelib: false\nTag: cp315-cp315-wasix_wasm32\n\n' >"$DI/WHEEL"
printf 'PIL\n' >"$DI/top_level.txt"
"$HOSTPY" - "$SITE" "pillow-$VERSION.dist-info" <<'PY'
import base64, hashlib, os, sys
site, di = sys.argv[1], sys.argv[2]
rows = []
for top in ("PIL", di):
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
WORK="$B" homescoop_notices_begin "The side modules link these libraries statically: libjpeg-turbo 3.1.2 into PIL/_imaging and FreeType 2.13.3 into PIL/_imagingft. zlib is python.wasm's (@ai-ecoverse/wasix-python), and Pillow's own licence is LICENSE."
WORK="$B" homescoop_notice "libjpeg-turbo 3.1.2 (IJG, BSD-3-Clause, Zlib)" "$JT/src/LICENSE.md" - "$JT/src/README.ijg" -
WORK="$B" homescoop_notice "FreeType 2.13.3 (FreeType License, FTL)" "$FT/src/LICENSE.TXT" - "$FT/src/docs/FTL.TXT" -
homescoop_compile_pyc "$SITE"
node "$ROOT/packages/py-kiwisolver/test/wasm-call-signatures.mjs" "$SITE"/PIL/*"$EXT"
echo "== py-pillow: staged $(du -sh "$DEST" | awk '{print $1}')"
