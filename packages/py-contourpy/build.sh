#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe py-contourpy

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="$WORK/py-contourpy-$VERSION"
DL="$B/dl"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export SOURCE_DATE_EPOCH=1764892800 PYTHONHASHSEED=0 ZERO_AR_DATE=1
mkdir -p "$DL"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe py-contourpy --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe py-contourpy
CP_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$CP_TGZ"

HOSTPY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOSTPY" ]] && command -v python3.14 >/dev/null 2>&1; then
  HOSTPY="$(command -v python3.14)"
fi
if [[ -z "$HOSTPY" ]]; then
  HOSTPY="$B/host/bin/python3.14"
  if [[ ! -x "$HOSTPY" ]]; then
    echo "== py-contourpy: host CPython 3.14.2 (compileall)"
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
export WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes WASIXCC_RUN_WASM_OPT=no
unset CC CXX CFLAGS CXXFLAGS CPPFLAGS LDFLAGS LIBS WASIXCC_MODULE_KIND

fetch_src wasix_python
PYDEV="$B/wasix-python"
rm -rf "$PYDEV" && mkdir -p "$PYDEV"
tar xzf "$SRC_FILE" -C "$PYDEV" package/include package/package.json
PYINC="$PYDEV/package/include/python3.14"
test -f "$PYINC/Python.h"
PYVER="$(node -p "require('$PYDEV/package/package.json').version")"
FLOOR="$(node --input-type=module -e "import { pythonRange } from '$ROOT/scripts/check-exact-pins.mjs'; import { readFileSync } from 'node:fs'; const r = pythonRange(JSON.parse(readFileSync('$DEST/package.json', 'utf8')).dependencies['@ai-ecoverse/wasix-python']); console.log(r ? r.floor : '')")"
[[ "$PYVER" == "$FLOOR" ]] || { echo "homescoop py-contourpy: headers from wasix-python $PYVER, but the package's range floor is '$FLOOR'" >&2; exit 1; }

fetch_src cxxrt
CXXRT="$B/cxxrt"
rm -rf "$CXXRT" && mkdir -p "$CXXRT"
tar xzf "$SRC_FILE" -C "$CXXRT" wasix-sysroot-ehpic/sysroot/include/c++
CXXINC="$CXXRT/wasix-sysroot-ehpic/sysroot/include/c++/v1"
test -f "$CXXINC/vector"

fetch_src pybind11
PB="$B/pybind11"
rm -rf "$PB" && mkdir -p "$PB"
tar xzf "$SRC_FILE" -C "$PB" --strip-components=1
test -f "$PB/include/pybind11/pybind11.h"

SRC="$B/contourpy-$VERSION"
rm -rf "$SRC"
tar xzf "$CP_TGZ" -C "$B"
homescoop_apply_patches "$SRC"

OBJ="$B/obj"
rm -rf "$OBJ" && mkdir -p "$OBJ"
CXXFLAGS=(-O3 -DNDEBUG -fPIC -fvisibility=hidden -std=c++17 -matomics -mbulk-memory -mmutable-globals -pthread
  -nostdinc++ -isystem "$CXXINC" -I"$PYINC" -I"$PB/include" -I"$SRC/src" "-DCONTOURPY_VERSION=$VERSION" -ffile-prefix-map="$B"=.)
for f in chunk_local contour_generator converter fill_type line_type mpl2005_original mpl2005 mpl2014 outer_or_hole serial threaded util wrap z_interp; do
  echo "== py-contourpy: wasixcc++ src/$f.cpp"
  wasixcc++ "${CXXFLAGS[@]}" -c "$SRC/src/$f.cpp" -o "$OBJ/$f.o"
done
SO="_contourpy.cpython-314-wasm32-wasix.so"
WASIXCC_MODULE_KIND=shared-library wasixcc++ -shared -fPIC -Wl,--allow-undefined -Wl,--export=PyInit__contourpy -o "$OBJ/$SO" "$OBJ"/*.o

SITE="$DEST/lib/python3.14/site-packages"
rm -rf "$DEST/lib"
mkdir -p "$SITE/contourpy/util"
for f in __init__.py _contourpy.pyi _version.py array.py chunk.py convert.py dechunk.py enum_util.py py.typed typecheck.py types.py; do
  cp "$SRC/lib/contourpy/$f" "$SITE/contourpy/$f"
done
for f in __init__.py bokeh_renderer.py bokeh_util.py data.py mpl_renderer.py mpl_util.py renderer.py; do
  cp "$SRC/lib/contourpy/util/$f" "$SITE/contourpy/util/$f"
done
"$HOSTPY" - "$SRC/lib/contourpy/util/_build_config.py.in" "$SITE/contourpy/util/_build_config.py" "$VERSION" <<'PY'
import re, sys
src, out, version = sys.argv[1:4]
values = {
    "python_version": "3.14", "python_install_dir": "lib/python3.14/site-packages/", "python_path": "",
    "contourpy_version": version, "meson_version": "", "mesonpy_version": "", "pybind11_version": "3.0.1",
    "meson_backend": "", "build_dir": "", "source_dir": "", "cross_build": "True",
    "build_options": "homescoop packages/py-contourpy/build.sh", "buildtype": "release", "cpp_std": "c++17",
    "debug": "False", "optimization": "3", "vsenv": "False", "b_ndebug": "true", "b_vscrt": "",
    "compiler_name": "clang", "compiler_version": "wasixcc", "linker_id": "wasm-ld", "compile_command": "wasixcc++",
    "host_cpu": "wasm32", "host_cpu_family": "wasm32", "host_cpu_endian": "little", "host_cpu_system": "wasi",
    "build_cpu": "", "build_cpu_family": "", "build_cpu_endian": "", "build_cpu_system": "",
}
text = open(src).read()
missing = sorted(set(re.findall(r"@([a-z_]+)@", text)) - set(values))
if missing:
    sys.exit(f"homescoop py-contourpy: _build_config.py.in has unknown keys {missing}")
open(out, "w").write(re.sub(r"@([a-z_]+)@", lambda m: values[m.group(1)], text))
PY
cp "$OBJ/$SO" "$SITE/contourpy/$SO"
chmod 755 "$SITE/contourpy/$SO"
DI="$SITE/contourpy-$VERSION.dist-info"
mkdir -p "$DI/licenses"
cp "$SRC/PKG-INFO" "$DI/METADATA"
cp "$SRC/LICENSE" "$DI/licenses/LICENSE"
printf 'Wheel-Version: 1.0\nGenerator: homescoop (packages/py-contourpy/build.sh)\nRoot-Is-Purelib: false\nTag: cp314-cp314-wasix_wasm32\n\n' >"$DI/WHEEL"
"$HOSTPY" - "$SITE" "contourpy-$VERSION.dist-info" <<'PY'
import base64, hashlib, os, sys
site, di = sys.argv[1], sys.argv[2]
rows = []
for top in ("contourpy", di):
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
node "$ROOT/packages/py-kiwisolver/test/wasm-call-signatures.mjs" "$SITE/contourpy/$SO"
echo "== py-contourpy: staged $(du -sh "$DEST" | awk '{print $1}')"
