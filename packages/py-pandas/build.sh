#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe py-pandas

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="$WORK/py-pandas-$VERSION"
DL="$B/dl"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export SOURCE_DATE_EPOCH=1755820800 PYTHONHASHSEED=0 ZERO_AR_DATE=1
mkdir -p "$DL"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe py-pandas --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe py-pandas
PD_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$PD_TGZ"

HOSTPY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOSTPY" ]] && command -v python3.15 >/dev/null 2>&1; then
  HOSTPY="$(command -v python3.15)"
fi
if [[ -z "$HOSTPY" ]]; then
  HOSTPY="$B/host/bin/python3.15"
  if [[ ! -x "$HOSTPY" ]]; then
    echo "== py-pandas: host CPython 3.15.0 (meson, cython, compileall)"
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
command -v ninja >/dev/null || { echo "homescoop py-pandas: need ninja" >&2; exit 1; }

# wasix-sysroot -38, as wasix-python 3.15.0-1 (the cp315 wave, #761).
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-38
export HOMESCOOP_WASIX_SYSROOT_SHA=1fb57c95d84e7b33a5a535561a0d536c943c40fefd70991f9570db8e27994574
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$B/wasixcc")"
export WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes WASIXCC_RUN_WASM_OPT=no
unset CC CXX CFLAGS CXXFLAGS CPPFLAGS LDFLAGS LIBS WASIXCC_MODULE_KIND
WASIXCC="$(command -v wasixcc)"
WASIXCXX="$(command -v wasixcc++)"

fetch_src wasix_python
PYDEV="$B/wasix-python"
rm -rf "$PYDEV" && mkdir -p "$PYDEV"
tar xzf "$SRC_FILE" -C "$PYDEV" package/include package/package.json
PYINC="$PYDEV/package/include/python3.15"
test -f "$PYINC/Python.h"
PYVER="$(node -p "require('$PYDEV/package/package.json').version")"
FLOOR="$(node --input-type=module -e "import { pythonRange } from '$ROOT/scripts/check-exact-pins.mjs'; import { readFileSync } from 'node:fs'; const r = pythonRange(JSON.parse(readFileSync('$DEST/package.json', 'utf8')).dependencies['@ai-ecoverse/wasix-python']); console.log(r ? r.floor : '')")"
[[ "$PYVER" == "$FLOOR" ]] || { echo "homescoop py-pandas: headers from wasix-python $PYVER, but the package's range floor is '$FLOOR'" >&2; exit 1; }

# phase B: libc++ headers from the sysroot (-38)
CXXINC="$WASIXCC_SYSROOT_PREFIX/sysroot-ehpic/include/c++/v1"
test -f "$CXXINC/vector"


fetch_src py_numpy
NPDEV="$B/py-numpy"
rm -rf "$NPDEV" && mkdir -p "$NPDEV"
tar xzf "$SRC_FILE" -C "$NPDEV" package/package.json package/lib/python3.15/site-packages/numpy/_core/include \
  package/lib/python3.15/site-packages/numpy/__init__.pxd package/lib/python3.15/site-packages/numpy/__init__.cython-30.pxd
NPINC="$NPDEV/package/lib/python3.15/site-packages/numpy/_core/include"
test -f "$NPINC/numpy/arrayobject.h"
NPVER="$(node -p "require('$NPDEV/package/package.json').version")"
NPFLOOR="$(node -p "(require('$DEST/package.json').dependencies['@ai-ecoverse/py-numpy'].match(/^>=(\S+) /) || [])[1] || ''")"
[[ "$NPVER" == "$NPFLOOR" ]] || { echo "homescoop py-pandas: numpy headers from py-numpy $NPVER, but the package's py-numpy floor is '$NPFLOOR'" >&2; exit 1; }

fetch_src cython
CYSITE="$B/cython-site"
rm -rf "$CYSITE" && mkdir -p "$CYSITE"
"$HOSTPY" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$SRC_FILE" "$CYSITE"
fetch_src meson
MESONSITE="$B/meson-site"
rm -rf "$MESONSITE" && mkdir -p "$MESONSITE"
"$HOSTPY" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$SRC_FILE" "$MESONSITE"

SRC="$B/pandas-$VERSION"
rm -rf "$SRC"
tar xzf "$PD_TGZ" -C "$B"
homescoop_apply_patches "$SRC"

TOOLS="$B/tools"
rm -rf "$TOOLS" && mkdir -p "$TOOLS/bin" "$TOOLS/site"
for t in cc c++; do
  real="$WASIXCC"
  [[ $t == c++ ]] && real="$WASIXCXX"
  cat >"$TOOLS/bin/wasix-$t" <<EOF
#!/usr/bin/env bash
args=(-fvisibility=default)
so=0
for a in "\$@"; do
  case "\$a" in *.cpython-315-wasm32-wasix.so) so=1 ;; esac
done
for a in "\$@"; do
  case "\$a" in
    -fno-exceptions|-fno-rtti|-fvisibility=hidden|--start-group|--end-group|-Wl,--start-group|-Wl,--end-group) continue ;;
  esac
  args+=("\$a")
done
if ((so)); then
  export WASIXCC_MODULE_KIND=shared-library
  args+=(-Wl,--fatal-warnings)
fi
exec "$real" "\${args[@]}"
EOF
  chmod +x "$TOOLS/bin/wasix-$t"
done
cat >"$TOOLS/site/sitecustomize.py" <<EOF
import platform, sysconfig
_INC = "$PYINC"
_OVERRIDES = {"SOABI": "cpython-315-wasm32-wasix", "EXT_SUFFIX": ".cpython-315-wasm32-wasix.so", "INCLUDEPY": _INC,
    "CONFINCLUDEPY": _INC, "HOST_GNU_TYPE": "wasm32-unknown-wasix", "MULTIARCH": "wasm32-wasix", "Py_ENABLE_SHARED": "0",
    "SHLIB_SUFFIX": ".so", "SIZEOF_VOID_P": "4", "SIZEOF_SIZE_T": "4", "SIZEOF_LONG": "4", "SIZEOF_TIME_T": "8",
    # the host python-3.15.pc (LIBPC) would put its own include dir first
    "LIBPC": "/nonexistent-homescoop"}
_get, _vars, _path, _paths = sysconfig.get_config_var, sysconfig.get_config_vars, sysconfig.get_path, sysconfig.get_paths
def get_config_var(name):
    return _OVERRIDES[name] if name in _OVERRIDES else _get(name)
def get_config_vars(*args):
    if not args:
        d = dict(_vars())
        d.update(_OVERRIDES)
        return d
    return [get_config_var(a) for a in args]
def get_path(name, *a, **k):
    return _INC if name in ("include", "platinclude") else _path(name, *a, **k)
def get_paths(*a, **k):
    d = dict(_paths(*a, **k))
    d["include"] = d["platinclude"] = _INC
    return d
sysconfig.get_config_var, sysconfig.get_config_vars, sysconfig.get_path, sysconfig.get_paths = get_config_var, get_config_vars, get_path, get_paths
sysconfig.get_platform = lambda: "wasix_wasm32"
platform.machine = lambda: "wasm32"
EOF
# The build python answers numpy.get_include() with py-numpy's wasm headers
# (pandas/meson.build asks it), and generate_version.py's top-level
# `import versioneer` is never used (the sdist has _version_meson.py).
mkdir -p "$TOOLS/site/numpy"
printf 'def get_include():\n    return %s\n' "'$NPINC'" >"$TOOLS/site/numpy/__init__.py"
# Cython's `cimport numpy` reads numpy's own declarations.
cp "$NPDEV/package/lib/python3.15/site-packages/numpy/"__init__*.pxd "$TOOLS/site/numpy/"
printf '# homescoop stub: the sdist ships _version_meson.py\n' >"$TOOLS/site/versioneer.py"
# wasm side modules have no rpaths: meson install's depfixer would run
# install_name_tool (macOS build machine) or the ELF fixer on them.
cat >>"$TOOLS/site/sitecustomize.py" <<'PYDEP'
try:
    import mesonbuild.scripts.depfixer as _depfixer
    _depfixer.fix_rpath = lambda *a, **k: None
except ImportError:
    pass
PYDEP
FLAGS="'-O2', '-fPIC', '-matomics', '-mbulk-memory', '-mmutable-globals', '-pthread', '-I$PYINC', '-ffile-prefix-map=$B=.'"
cat >"$TOOLS/cross.ini" <<EOF
[host_machine]
system = 'wasi'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'

[binaries]
c = '$TOOLS/bin/wasix-cc'
cpp = '$TOOLS/bin/wasix-c++'
ar = '$(command -v wasixar)'

[properties]
needs_exe_wrapper = true
skip_sanity_check = true

[built-in options]
c_args = [$FLAGS]
cpp_args = [$FLAGS, '-nostdinc++', '-isystem', '$CXXINC']
c_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined']
cpp_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined']
EOF
# A cython executable: meson runs the shared-utility step (Cython 3.1+'s
# --generate-shared, which pandas 3 uses) with only the first element of a
# list-valued cython binary.
printf '#!/bin/sh\nexec %s -m cython "$@"\n' "$HOSTPY" >"$TOOLS/bin/cython"
chmod +x "$TOOLS/bin/cython"
cat >"$TOOLS/native.ini" <<EOF
[binaries]
python = '$HOSTPY'
cython = '$TOOLS/bin/cython'
EOF

BUILD="$B/build"
STAGE="$B/stage"
rm -rf "$BUILD" "$STAGE"
export PYTHONPATH="$TOOLS/site:$CYSITE:$MESONSITE"
echo "== py-pandas: meson setup"
(cd "$SRC" && "$HOSTPY" -m mesonbuild.mesonmain setup "$BUILD" --cross-file "$TOOLS/cross.ini" --native-file "$TOOLS/native.ini" \
  -Dbuildtype=release -Db_ndebug=if-release \
  --prefix=/usr --python.purelibdir=lib/python3.15/site-packages --python.platlibdir=lib/python3.15/site-packages) >"$B/meson-setup.log" 2>&1 \
  || { tail -80 "$B/meson-setup.log" >&2; exit 1; }
grep -E "Cython compiler for the host machine" "$B/meson-setup.log" || { tail -40 "$B/meson-setup.log" >&2; exit 1; }
echo "== py-pandas: ninja (-j$JOBS)"
ninja -C "$BUILD" -j"$JOBS" >"$B/ninja.log" 2>&1 || { tail -80 "$B/ninja.log" >&2; exit 1; }
(cd "$SRC" && DESTDIR="$STAGE" "$HOSTPY" -m mesonbuild.mesonmain install -C "$BUILD" --no-rebuild --skip-subprojects) >"$B/install.log" 2>&1 \
  || { tail -40 "$B/install.log" >&2; exit 1; }
unset PYTHONPATH
SP="$(dirname "$(find "$STAGE" -type d -path '*/site-packages/pandas' | head -1)")"
test -d "$SP/pandas"

SITE="$DEST/lib/python3.15/site-packages"
rm -rf "$DEST/lib"
mkdir -p "$SITE"
cp -R "$SP/pandas" "$SITE/pandas"
find "$SITE/pandas" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$SITE/pandas" -name '*.so' -exec chmod 755 {} +
DI="$SITE/pandas-$VERSION.dist-info"
mkdir -p "$DI/licenses"
cp "$SRC/PKG-INFO" "$DI/METADATA"
cp "$SRC/LICENSE" "$DI/licenses/LICENSE"
printf 'Wheel-Version: 1.0\nGenerator: homescoop (packages/py-pandas/build.sh)\nRoot-Is-Purelib: false\nTag: cp315-cp315-wasix_wasm32\n\n' >"$DI/WHEEL"
# pandas 3.0.6's pyproject.toml [project.entry-points.pandas_plotting_backends].
printf '[pandas_plotting_backends]\nmatplotlib = pandas:plotting._matplotlib\n' >"$DI/entry_points.txt"
"$HOSTPY" - "$SITE" "pandas-$VERSION.dist-info" <<'PY'
import base64, hashlib, os, sys
site, di = sys.argv[1], sys.argv[2]
rows = []
for top in ("pandas", di):
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
L="$SRC/LICENSES"
WORK="$B" homescoop_notices_begin "pandas' side modules compile in code from klib (khash), ultrajson, numpy's datetime support and musl; its Python sources include code from the other projects below. pandas' own licence is LICENSE. The licence files are pandas $VERSION's LICENSES/."
WORK="$B" homescoop_notice "klib (khash; MIT)" "$L/KLIB_LICENSE" -
WORK="$B" homescoop_notice "ultrajson (BSD-3-Clause)" "$L/ULTRAJSON_LICENSE" -
WORK="$B" homescoop_notice "numpy (datetime support; BSD-3-Clause)" "$L/NUMPY_LICENSE" -
WORK="$B" homescoop_notice "musl (MIT)" "$L/MUSL_LICENSE" -
for f in BOTTLENECK_LICENCE DATEUTIL_LICENSE HAVEN_LICENSE HAVEN_MIT PACKAGING_LICENSE PSF_LICENSE PYPERCLIP_LICENSE PYUPGRADE_LICENSE SAS7BDAT_LICENSE; do
  WORK="$B" homescoop_notice "$f (pandas LICENSES/$f)" "$L/$f" -
done
homescoop_compile_pyc "$SITE"

mapfile -t SOS < <(find "$SITE" -name '*.cpython-315-wasm32-wasix.so' | sort)
echo "== py-pandas: ${#SOS[@]} side modules"
((${#SOS[@]} >= 40)) || { echo "homescoop py-pandas: only ${#SOS[@]} side modules" >&2; exit 1; }
node "$ROOT/packages/py-kiwisolver/test/wasm-call-signatures.mjs" "${SOS[@]}" || echo "py-pandas: call-signature mismatches above"
echo "== py-pandas: staged $(du -sh "$DEST" | awk '{print $1}')"
