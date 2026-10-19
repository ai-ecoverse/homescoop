#!/usr/bin/env bash
# SciPy for slicc WASIX CPython 3.15 (the cp315 line, homescoop#761), from the PyPI sdist (homescoop#211 A6).
# meson + Cython on the host python, numpy's f2py as a code generator, wasixcc
# PIC side modules; no Fortran (scipy 1.18's -D_without-fortran: only the
# deprecated scipy.odr goes); BLAS/LAPACK from @ai-ecoverse/wasix-openblas.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
RECIPE=py-scipy3.15
PYMM=3.15
PYTAG=315
homescoop_load_recipe "$RECIPE"

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="$WORK/py-scipy-$VERSION"
DL="$B/dl"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export SOURCE_DATE_EPOCH=1782899241 PYTHONHASHSEED=0 ZERO_AR_DATE=1
mkdir -p "$DL"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe "$RECIPE" --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe "$RECIPE"
SP_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SP_TGZ"

HOSTPY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOSTPY" ]]; then
  HOSTPY="$B/host/bin/python$PYMM"
  if [[ ! -x "$HOSTPY" ]]; then
    echo "== py-scipy: host CPython $PYMM (meson, cython, f2py, compileall)"
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
"$HOSTPY" -c 'import sys; assert "%d.%d" % sys.version_info[:2] == sys.argv[1], sys.version' "$PYMM"
export WASIX_PYTHON_HOST_PY="$HOSTPY"
command -v ninja >/dev/null || { echo "homescoop py-scipy: need ninja" >&2; exit 1; }
command -v pkg-config >/dev/null || { echo "homescoop py-scipy: need pkg-config" >&2; exit 1; }

# wasix-sysroot -38, the one wasix-openblas 0.3.28-1 is built on.
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-38
export HOMESCOOP_WASIX_SYSROOT_SHA=1fb57c95d84e7b33a5a535561a0d536c943c40fefd70991f9570db8e27994574
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$B/wasixcc")"
export WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes WASIXCC_RUN_WASM_OPT=no
unset CC CXX CFLAGS CXXFLAGS CPPFLAGS LDFLAGS LIBS WASIXCC_MODULE_KIND
WASIXCC="$(command -v wasixcc)"
WASIXCXX="$(command -v wasixcc++)"
CXXINC="$WASIXCC_SYSROOT_PREFIX/sysroot-ehpic/include/c++/v1"
test -f "$CXXINC/vector"

fetch_src wasix_python
PYDEV="$B/wasix-python"
rm -rf "$PYDEV" && mkdir -p "$PYDEV"
tar xzf "$SRC_FILE" -C "$PYDEV" package/include package/package.json
PYINC="$PYDEV/package/include/python$PYMM"
test -f "$PYINC/Python.h"
PYVER="$(node -p "require('$PYDEV/package/package.json').version")"
FLOOR="$(node --input-type=module -e "import { pythonRange } from '$ROOT/scripts/check-exact-pins.mjs'; import { readFileSync } from 'node:fs'; const r = pythonRange(JSON.parse(readFileSync('$DEST/package.json', 'utf8')).dependencies['@ai-ecoverse/wasix-python']); console.log(r ? r.floor : '')")"
[[ "$PYVER" == "$FLOOR" ]] || { echo "homescoop py-scipy: headers from wasix-python $PYVER, but the package's range floor is '$FLOOR'" >&2; exit 1; }

# py-numpy: its wasm headers, Cython declarations and f2py (pure Python; the
# host runs it as a code generator, without numpy's C core).
fetch_src py_numpy
NPDEV="$B/py-numpy"
NPSP="package/lib/python$PYMM/site-packages/numpy"
rm -rf "$NPDEV" && mkdir -p "$NPDEV"
tar xzf "$SRC_FILE" -C "$NPDEV" package/package.json "$NPSP"
NPINC="$NPDEV/$NPSP/_core/include"
test -f "$NPINC/numpy/arrayobject.h"
test -f "$NPDEV/$NPSP/f2py/src/fortranobject.c"
NPVER="$(node -p "require('$NPDEV/package/package.json').version")"
NPFLOOR="$(node -p "(require('$DEST/package.json').dependencies['@ai-ecoverse/py-numpy'].match(/^>=(\S+) /) || [])[1] || ''")"
[[ "$NPVER" == "$NPFLOOR" ]] || { echo "homescoop py-scipy: numpy headers from py-numpy $NPVER, but the package's py-numpy floor is '$NPFLOOR'" >&2; exit 1; }
NPUP="${NPVER%-*}"

fetch_src wasix_openblas
OB="$B/wasix-openblas"
rm -rf "$OB" && mkdir -p "$OB"
tar xzf "$SRC_FILE" -C "$OB"
OB="$OB/package"
test -f "$OB/lib/libopenblas.a" && test -f "$OB/lib/pkgconfig/openblas.pc"
OBVER="$(node -p "require('$OB/package.json').version")"

fetch_src cython
CYSITE="$B/cython-site"
rm -rf "$CYSITE" && mkdir -p "$CYSITE"
"$HOSTPY" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$SRC_FILE" "$CYSITE"
fetch_src meson
MESONSITE="$B/meson-site"
rm -rf "$MESONSITE" && mkdir -p "$MESONSITE"
"$HOSTPY" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$SRC_FILE" "$MESONSITE"
fetch_src pybind11
PBSITE="$B/pybind11-site"
rm -rf "$PBSITE" && mkdir -p "$PBSITE"
"$HOSTPY" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$SRC_FILE" "$PBSITE"
PBPC="$(dirname "$(find "$PBSITE" -name pybind11.pc | head -1)")"
test -f "$PBPC/pybind11.pc"

SRC="$B/scipy-$VERSION"
rm -rf "$SRC"
tar xzf "$SP_TGZ" -C "$B"
homescoop_apply_patches "$SRC"
# scipy's own BLAS/LAPACK prototypes say void; wasix-openblas returns int.
"$HOSTPY" "$PKG/tools/scipy_cfix.py" --tree "$SRC/scipy" >"$B/cfix.log"
tail -1 "$B/cfix.log"

TOOLS="$B/tools"
rm -rf "$TOOLS" && mkdir -p "$TOOLS/bin" "$TOOLS/site" "$TOOLS/pkgconfig"
CFIX="$PKG/tools/scipy_cfix.py"
for t in cc c++; do
  real="$WASIXCC"
  [[ $t == c++ ]] && real="$WASIXCXX"
  cat >"$TOOLS/bin/wasix-$t" <<EOF
#!/usr/bin/env bash
# meson reads the compiler version off the first line; wasixcc prints its own
# version there and clang's further down (scipy asks for c_std=c17).
if [[ "\$*" == --version ]]; then
  "$real" --version | grep -m1 'clang version' | sed 's/^WASIX //'
  "$real" --version | grep -v 'clang version'
  exit 0
fi
args=(-fvisibility=default)
# wasm has only round-to-nearest: wasi-libc's fenv.h has no FE_UPWARD &c.;
# scipy.special's _test_internal names them (fesetround then fails, as the
# test expects on such targets).
args+=(-DFE_UPWARD=0x800 -DFE_DOWNWARD=0x400 -DFE_TOWARDZERO=0xc00)
so=0
fix=()
for a in "\$@"; do
  case "\$a" in
    *.cpython-$PYTAG-wasm32-wasix.so) so=1 ;;
    *module.c|*cython_lapack.c|*cython_blas.c) [[ -f "\$a" ]] && fix+=("\$a") ;;
    *_cyutility.c) [[ -f "\$a" ]] && "$HOSTPY" "$CFIX" --cyutility "\$a" ;;
  esac
done
((\${#fix[@]})) && "$HOSTPY" "$CFIX" "\${fix[@]}"
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
_OVERRIDES = {"SOABI": "cpython-$PYTAG-wasm32-wasix", "EXT_SUFFIX": ".cpython-$PYTAG-wasm32-wasix.so", "INCLUDEPY": _INC,
    "CONFINCLUDEPY": _INC, "HOST_GNU_TYPE": "wasm32-unknown-wasix", "MULTIARCH": "wasm32-wasix", "Py_ENABLE_SHARED": "0",
    "SHLIB_SUFFIX": ".so", "SIZEOF_VOID_P": "4", "SIZEOF_SIZE_T": "4", "SIZEOF_LONG": "4", "SIZEOF_TIME_T": "8",
    # the host python's python-3.X.pc (LIBPC) would put its own include dir first
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
# wasm side modules have no rpaths: meson install's depfixer would run
# install_name_tool (macOS build machine) or the ELF fixer on them.
try:
    import mesonbuild.scripts.depfixer as _depfixer
    _depfixer.fix_rpath = lambda *a, **k: None
except ImportError:
    pass
EOF
# The host's numpy: py-numpy's pure-Python f2py and Cython declarations, and
# get_include() answering with its wasm headers. intp is the target's npy_intp.
HNP="$TOOLS/site/numpy"
mkdir -p "$HNP"
cp -R "$NPDEV/$NPSP/f2py" "$HNP/f2py"
cp "$NPDEV/$NPSP/version.py" "$NPDEV/$NPSP/exceptions.py" "$HNP/"
(cd "$NPDEV/$NPSP" && find . -name '*.pxd' -not -path '*/tests/*' | while read -r f; do mkdir -p "$HNP/$(dirname "$f")"; cp "$f" "$HNP/$f"; done)
find "$HNP" -name '*.so' -delete
find "$HNP" -name __pycache__ -prune -exec rm -rf {} +
cat >"$HNP/__init__.py" <<EOF
# homescoop host stub (packages/py-scipy3.15/build.sh): numpy.f2py as a code
# generator and the wasm headers, without numpy's C core.
from .version import version as __version__
class intp:  # npy_intp on wasm32
    itemsize = 4
def get_include():
    return "$NPINC"
EOF
cat >"$TOOLS/pkgconfig/numpy.pc" <<EOF
Name: numpy
Description: py-numpy $NPVER wasm headers
Version: $NPUP
Cflags: -I$NPINC
EOF
printf '#!/bin/sh\nexec "%s" -m numpy.f2py "$@"\n' "$HOSTPY" >"$TOOLS/bin/f2py"
printf '#!/bin/sh\nexec "%s" -m cython "$@"\n' "$HOSTPY" >"$TOOLS/bin/cython"
chmod +x "$TOOLS/bin/f2py" "$TOOLS/bin/cython"

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
pkg-config = '$(command -v pkg-config)'

[properties]
needs_exe_wrapper = true
skip_sanity_check = true
longdouble_format = 'IEEE_QUAD_LE'
numpy-include-dir = '$NPINC'
pkg_config_libdir = ['$TOOLS/pkgconfig', '$OB/lib/pkgconfig', '$PBPC']

[built-in options]
c_args = [$FLAGS]
cpp_args = [$FLAGS, '-nostdinc++', '-isystem', '$CXXINC']
c_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined']
cpp_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined']
EOF
cat >"$TOOLS/native.ini" <<EOF
[binaries]
python = '$HOSTPY'
python3 = '$HOSTPY'
cython = '$TOOLS/bin/cython'
EOF

BUILD="$B/build"
STAGE="$B/stage"
rm -rf "$BUILD" "$STAGE"
export PYTHONPATH="$TOOLS/site:$CYSITE:$MESONSITE"
export PATH="$TOOLS/bin:$PATH"
echo "== py-scipy: meson setup"
(cd "$SRC" && "$HOSTPY" -m mesonbuild.mesonmain setup "$BUILD" --cross-file "$TOOLS/cross.ini" --native-file "$TOOLS/native.ini" \
  -Dbuildtype=release -Db_ndebug=if-release -D_without-fortran=true -Duse-pythran=false \
  -Dblas=openblas -Dlapack=openblas -Duse-g77-abi=true \
  --prefix=/usr --python.purelibdir="lib/python$PYMM/site-packages" --python.platlibdir="lib/python$PYMM/site-packages") >"$B/meson-setup.log" 2>&1 \
  || { tail -80 "$B/meson-setup.log" >&2; exit 1; }
grep -E "Run-time dependency openblas found: YES" "$B/meson-setup.log" || { grep -iE "openblas|blas|lapack" "$B/meson-setup.log" | tail -20 >&2; exit 1; }
echo "== py-scipy: ninja (-j$JOBS)"
ninja -C "$BUILD" -j"$JOBS" >"$B/ninja.log" 2>&1 || { grep -E "error|FAILED|warning: function signature" "$B/ninja.log" | head -40 >&2; tail -40 "$B/ninja.log" >&2; exit 1; }
(cd "$SRC" && DESTDIR="$STAGE" "$HOSTPY" -m mesonbuild.mesonmain install -C "$BUILD" --no-rebuild --skip-subprojects --tags runtime,python-runtime) >"$B/install.log" 2>&1 \
  || { tail -40 "$B/install.log" >&2; exit 1; }
unset PYTHONPATH
SPDIR="$(dirname "$(find "$STAGE" -type d -path '*/site-packages/scipy' | head -1)")"
test -d "$SPDIR/scipy"

SITE="$DEST/lib/python$PYMM/site-packages"
rm -rf "$DEST/lib"
mkdir -p "$SITE"
cp -R "$SPDIR/scipy" "$SITE/scipy"
# scipy/__config__.py records the toolchain's and the build's absolute paths
# (compilers, include, library and pkg-config dirs): name them relative to the
# build root, as -ffile-prefix-map does for the objects (reproducible job).
"$HOSTPY" - "$SITE/scipy/__config__.py" "$B" "$WORK" "$ROOT" <<'PYCFG'
import sys
p, *roots = sys.argv[1:]
t = open(p).read()
for r in sorted({x.rstrip("/") for x in roots if x and x != "/"}, key=len, reverse=True):
    t = t.replace(r + "/", "./").replace(r, ".")
open(p, "w").write(t)
PYCFG
! grep -qF "$B" "$SITE/scipy/__config__.py"
find "$SITE/scipy" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$SITE/scipy" -type d -name tests -prune -exec rm -rf {} +
find "$SITE/scipy" -name '*.so' -exec chmod 755 {} +
# DWARF from the sysroot's archives (homescoop#890) goes now, before RECORD
# hashes the files (host-run's own strip would come after it).
node "$ROOT/scripts/check-no-debug.mjs" "$RECIPE" "$DEST" --strip
DI="$SITE/scipy-$VERSION.dist-info"
mkdir -p "$DI/licenses"
cp "$SRC/PKG-INFO" "$DI/METADATA"
cat "$SRC/LICENSE.txt" "$SRC/LICENSES_bundled.txt" >"$DI/licenses/LICENSE.txt"
printf 'Wheel-Version: 1.0\nGenerator: homescoop (packages/%s/build.sh)\nRoot-Is-Purelib: false\nTag: cp%s-cp%s-wasix_wasm32\n\n' "$RECIPE" "$PYTAG" "$PYTAG" >"$DI/WHEEL"
"$HOSTPY" - "$SITE" "scipy-$VERSION.dist-info" <<'PY'
import base64, hashlib, os, sys
site, di = sys.argv[1], sys.argv[2]
rows = []
for top in ("scipy", di):
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
# scipy's wheels ship LICENSE.txt with LICENSES_bundled.txt appended.
cat "$SRC/LICENSE.txt" "$SRC/LICENSES_bundled.txt" >"$DEST/LICENSE"
# wasix-openblas' LICENSE is OpenBLAS', LAPACK's and GotoBLAS2's, each after a
# "==> LICENSE <==" line.
awk -v d="$B/oblic" '/^==> /{n++; next} {print > (d "." n)}' "$OB/LICENSE"
test -s "$B/oblic.3"
WORK="$B" homescoop_notices_begin "scipy's side modules that call BLAS/LAPACK link OpenBLAS $OBVER statically (@ai-ecoverse/wasix-openblas: OpenBLAS, its C translation of netlib LAPACK, and GotoBLAS2 code), and the C++ ones compile in pybind11's headers. scipy's own licence is LICENSE, with scipy's LICENSES_bundled.txt appended; the licence texts of the code it lists follow."
WORK="$B" homescoop_notice "OpenBLAS $OBVER (BSD-3-Clause)" "$B/oblic.1" -
WORK="$B" homescoop_notice "LAPACK, OpenBLAS lapack-netlib (BSD-3-Clause)" "$B/oblic.2" -
WORK="$B" homescoop_notice "GotoBLAS2 (BSD-2-Clause)" "$B/oblic.3" -
WORK="$B" homescoop_notice "pybind11 3.0.1 (BSD-3-Clause; headers compiled into scipy.optimize._highspy and others)" "$(find "$PBSITE" -name LICENSE -path '*pybind11*' | head -1)" -
# The code scipy bundles (LICENSES_bundled.txt): the larger libraries by name,
WORK="$B" homescoop_notice "SuperLU (BSD-3-Clause; bundled by scipy)" "$SRC/scipy/sparse/linalg/_dsolve/SuperLU/License.txt" -
WORK="$B" homescoop_notice "ARPACK (BSD-3-Clause; bundled by scipy, arnaud)" "$SRC/scipy/sparse/linalg/_eigen/arpack/arnaud/ARPACK_LICENSE.txt" -
WORK="$B" homescoop_notice "Qhull (Qhull; bundled by scipy)" "$SRC/subprojects/qhull_r/libqhull_r/COPYING.txt" -
WORK="$B" homescoop_notice "HiGHS (MIT; bundled by scipy)" "$SRC/subprojects/highs/LICENSE.txt" -
WORK="$B" homescoop_notice "Boost (Boost.Math; BSL-1.0; bundled by scipy)" "$SRC/subprojects/boost_math/math/LICENSE" -
WORK="$B" homescoop_notice "UNU.RAN (BSD-3-Clause by permission; bundled by scipy)" "$SRC/subprojects/unuran/license.txt" -
# then one section per other entry whose
# "For details, see <file>" is a licence file in the sdist.
"$HOSTPY" - "$SRC" >"$B/bundled.tsv" <<'PY'
import os, re, sys
src = sys.argv[1]
text = open(os.path.join(src, "LICENSES_bundled.txt")).read()
named = {"SuperLU", "ARPACK", "Qhull", "HiGHS", "Boost", "UNU.RAN"}  # above
for block in re.split(r"\n(?=Name: )", text):
    m = re.match(r"Name: (.+)", block)
    lic = re.search(r"^License: (.+)$", block, re.M)
    if not (m and lic) or m.group(1).strip() in named:
        continue
    for f in re.findall(r"see (\S+)", block):
        f = f.rstrip(".,")
        if re.search(r"(licen[cs]e|copying)[^/]*$", f, re.I) and os.path.isfile(os.path.join(src, f)):
            print(f"{m.group(1).strip()}\t{lic.group(1).strip()}\t{f}")
            break
PY
while IFS=$'\t' read -r n l f; do
  WORK="$B" homescoop_notice "$n ($l; bundled by scipy, $f)" "$SRC/$f" -
done <"$B/bundled.tsv"
homescoop_compile_pyc "$SITE"

mapfile -t SOS < <(find "$SITE" -name "*.cpython-$PYTAG-wasm32-wasix.so" | sort)
echo "== py-scipy: ${#SOS[@]} side modules"
((${#SOS[@]} >= 90)) || { echo "homescoop py-scipy: only ${#SOS[@]} side modules" >&2; exit 1; }
node "$ROOT/packages/py-kiwisolver/test/wasm-call-signatures.mjs" "${SOS[@]}" || echo "py-scipy: call-signature mismatches above"
echo "== py-scipy: staged $(du -sh "$DEST" | awk '{print $1}')"
