#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe py-numpy

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="$WORK/py-numpy-$VERSION"
DL="$B/dl"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export SOURCE_DATE_EPOCH=1753366800 PYTHONHASHSEED=0 ZERO_AR_DATE=1
mkdir -p "$DL"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe py-numpy --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe py-numpy
NP_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$NP_TGZ"

HOSTPY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOSTPY" ]] && command -v python3.15 >/dev/null 2>&1; then
  HOSTPY="$(command -v python3.15)"
fi
if [[ -z "$HOSTPY" ]]; then
  HOSTPY="$B/host/bin/python3.15"
  if [[ ! -x "$HOSTPY" ]]; then
    echo "== py-numpy: host CPython 3.15.0 (meson, cython, compileall)"
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
command -v ninja >/dev/null || { echo "homescoop py-numpy: need ninja" >&2; exit 1; }

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
[[ "$PYVER" == "$FLOOR" ]] || { echo "homescoop py-numpy: headers from wasix-python $PYVER, but the package's range floor is '$FLOOR'" >&2; exit 1; }

# phase B: libc++ headers from the sysroot (-38: the same runtimes and headers python links)
CXXINC="$WASIXCC_SYSROOT_PREFIX/sysroot-ehpic/include/c++/v1"
test -f "$CXXINC/vector"

echo "== py-numpy: OpenBLAS from @ai-ecoverse/wasix-openblas (static PIC, C LAPACK, f2c int ABI)"
fetch_src wasix_openblas
OBDL="$B/wasix-openblas"
rm -rf "$OBDL" && mkdir -p "$OBDL"
tar xzf "$SRC_FILE" -C "$OBDL"
OBP="$OBDL/package"
OBVER="$(node -p "require('$OBP/package.json').version")"
test -f "$OBP/lib/libopenblas.a" && test -f "$OBP/lib/pkgconfig/openblas.pc"

fetch_src cython
CYSITE="$B/cython-site"
rm -rf "$CYSITE" && mkdir -p "$CYSITE"
"$HOSTPY" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$SRC_FILE" "$CYSITE"

SRC="$B/numpy-$VERSION"
rm -rf "$SRC"
tar xzf "$NP_TGZ" -C "$B"
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
    -lopenblas) args+=(-Wl,--whole-archive -lopenblas -Wl,--no-whole-archive); continue ;;
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
# wasm side modules have no rpaths: meson install's depfixer would run
# install_name_tool (macOS build machine) or the ELF fixer on them.
try:
    import mesonbuild.scripts.depfixer as _depfixer
    _depfixer.fix_rpath = lambda *a, **k: None
except ImportError:
    pass
EOF
FLAGS="'-O2', '-fPIC', '-matomics', '-mbulk-memory', '-mmutable-globals', '-pthread', '-I$PYINC', '-I$OBP/include', '-ffile-prefix-map=$B=.'"
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
pkg-config = '$(command -v pkg-config || echo pkg-config)'

[properties]
needs_exe_wrapper = true
skip_sanity_check = true
longdouble_format = 'IEEE_QUAD_LE'
pkg_config_libdir = '$OBP/lib/pkgconfig'

[built-in options]
c_args = [$FLAGS]
cpp_args = [$FLAGS, '-nostdinc++', '-isystem', '$CXXINC']
c_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined', '-L$OBP/lib']
cpp_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined', '-L$OBP/lib']
EOF
cat >"$TOOLS/native.ini" <<EOF
[binaries]
python = '$HOSTPY'
cython = ['$HOSTPY', '-m', 'cython']
EOF

BUILD="$B/build"
STAGE="$B/stage"
rm -rf "$BUILD" "$STAGE"
export PYTHONPATH="$TOOLS/site:$CYSITE"
export PKG_CONFIG_LIBDIR="$OBP/lib/pkgconfig"
echo "== py-numpy: meson setup (numpy's vendored meson)"
(cd "$SRC" && "$HOSTPY" vendored-meson/meson/meson.py setup "$BUILD" --cross-file "$TOOLS/cross.ini" --native-file "$TOOLS/native.ini" \
  -Dallow-noblas=false -Dblas=openblas -Dlapack=openblas -Dbuildtype=release -Db_ndebug=if-release \
  --prefix=/usr --python.purelibdir=lib/python3.15/site-packages --python.platlibdir=lib/python3.15/site-packages) >"$B/meson-setup.log" 2>&1 \
  || { tail -80 "$B/meson-setup.log" >&2; exit 1; }
grep -E "Run-time dependency openblas found: YES|Program cython found|Cross compiling" "$B/meson-setup.log" || { grep -n -i "openblas\|blas" "$B/meson-setup.log" | head -20 >&2; exit 1; }
echo "== py-numpy: ninja (-j$JOBS)"
ninja -C "$BUILD" -j"$JOBS" >"$B/ninja.log" 2>&1 || { tail -80 "$B/ninja.log" >&2; exit 1; }
PYTHONPATH="$TOOLS/site:$CYSITE:$SRC/vendored-meson/meson" DESTDIR="$STAGE" "$HOSTPY" "$SRC/vendored-meson/meson/meson.py" install -C "$BUILD" --no-rebuild --skip-subprojects >"$B/install.log" 2>&1 \
  || { tail -40 "$B/install.log" >&2; exit 1; }
unset PYTHONPATH PKG_CONFIG_LIBDIR
SP="$(dirname "$(find "$STAGE" -type d -path '*/site-packages/numpy' | head -1)")"
test -d "$SP/numpy"

SITE="$DEST/lib/python3.15/site-packages"
rm -rf "$DEST/lib"
mkdir -p "$SITE"
cp -R "$SP/numpy" "$SITE/numpy"
# numpy/__config__.py records the toolchain's and the build's absolute paths
# (compiler, include and library dirs): name them relative to the build root,
# as -ffile-prefix-map does for the objects, so a rebuild elsewhere matches.
python3 - "$SITE/numpy/__config__.py" "$B" "$WORK" "$ROOT" <<'PYCFG'
import sys
p, *roots = sys.argv[1:]
t = open(p).read()
import re
# The prefix map itself carries no information once the paths are relative
# (it read -ffile-prefix-map=.=. after the rewrite, homescoop#1088).
t = re.sub(r",? ?-ffile-prefix-map=[^,\"]*", "", t)
for r in sorted({x.rstrip("/") for x in roots if x}, key=len, reverse=True):
    t = t.replace(r + "/", "./").replace(r, ".")
open(p, "w").write(t)
PYCFG
! grep -qF "$B" "$SITE/numpy/__config__.py"
find "$SITE/numpy" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$SITE/numpy" -name '*.so' -exec chmod 755 {} +
DI="$SITE/numpy-$VERSION.dist-info"
mkdir -p "$DI/licenses"
cp "$SRC/PKG-INFO" "$DI/METADATA"
cp "$SRC/LICENSE.txt" "$DI/licenses/LICENSE.txt"
printf 'Wheel-Version: 1.0\nGenerator: homescoop (packages/py-numpy/build.sh)\nRoot-Is-Purelib: false\nTag: cp315-cp315-wasix_wasm32\n\n' >"$DI/WHEEL"
# numpy 2.3.2's pyproject.toml [project.scripts] and [project.entry-points.*] (#1084).
printf '[array_api]\nnumpy = numpy\n\n[console_scripts]\nf2py = numpy.f2py.f2py2e:main\nnumpy-config = numpy._configtool:main\n\n[pkg_config]\nnumpy = numpy._core.lib.pkgconfig\n\n[pyinstaller40]\nhook-dirs = numpy:_pyinstaller_hooks_dir\n' >"$DI/entry_points.txt"
"$HOSTPY" - "$SITE" "numpy-$VERSION.dist-info" <<'PY'
import base64, hashlib, os, sys
site, di = sys.argv[1], sys.argv[2]
rows = []
for top in ("numpy", di):
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
cp "$SRC/LICENSE.txt" "$DEST/LICENSE"
# wasix-openblas' LICENSE is OpenBLAS', LAPACK's and GotoBLAS2's, each after a
# "==> LICENSE <==" line.
awk -v d="$B/oblic" '/^==> /{n++; next} {print > (d "." n)}' "$OBP/LICENSE"
test -s "$B/oblic.3"
# numpy.random's LICENSE.md files have markdown headings ("## The MIT
# License"), which would split their THIRD-PARTY-NOTICES.md sections: plain text.
R="$B/random-licences"
rm -rf "$R" && mkdir -p "$R"
for g in mt19937 pcg64 philox sfc64 splitmix64 distributions; do
  mkdir -p "$R/$g" && sed -E 's/^#+ +//' "$SRC/numpy/random/src/$g/LICENSE.md" >"$R/$g/LICENSE.md"
done
WORK="$B" homescoop_notices_begin "numpy/_core/_multiarray_umath, numpy/linalg/_umath_linalg and numpy/linalg/lapack_lite link OpenBLAS $OBVER statically (@ai-ecoverse/wasix-openblas: OpenBLAS, its C translation of netlib LAPACK, and GotoBLAS2 code); the umath loops compile in libdivide and Highway, numpy.fft pocketfft, and numpy.random its bit generators and distributions. numpy's own licence is LICENSE."
WORK="$B" homescoop_notice "OpenBLAS $OBVER (BSD-3-Clause)" "$B/oblic.1" -
WORK="$B" homescoop_notice "LAPACK, OpenBLAS lapack-netlib (BSD-3-Clause)" "$B/oblic.2" -
WORK="$B" homescoop_notice "GotoBLAS2 (BSD-2-Clause)" "$B/oblic.3" -
WORK="$B" homescoop_notice "libdivide (Zlib)" "$SRC/numpy/_core/include/numpy/libdivide/LICENSE.txt" -
WORK="$B" homescoop_notice "pocketfft (BSD-3-Clause; numpy.fft)" "$SRC/numpy/fft/pocketfft/LICENSE.md" -
WORK="$B" homescoop_notice "Highway (Apache-2.0 OR BSD-3-Clause)" "$SRC/numpy/_core/src/highway/LICENSE" -
WORK="$B" homescoop_notice "MT19937 (BSD-3-Clause; numpy.random)" "$R/mt19937/LICENSE.md" -
WORK="$B" homescoop_notice "PCG64 (MIT; numpy.random)" "$R/pcg64/LICENSE.md" -
WORK="$B" homescoop_notice "Philox (BSD-3-Clause; numpy.random)" "$R/philox/LICENSE.md" -
WORK="$B" homescoop_notice "SFC64 (MIT; numpy.random)" "$R/sfc64/LICENSE.md" -
WORK="$B" homescoop_notice "SplitMix64 (CC0-1.0; numpy.random)" "$R/splitmix64/LICENSE.md" -
WORK="$B" homescoop_notice "numpy.random distributions (BSD-3-Clause and others)" "$R/distributions/LICENSE.md" -
homescoop_compile_pyc "$SITE"

mapfile -t SOS < <(find "$SITE" -name '*.cpython-315-wasm32-wasix.so' | sort)
echo "== py-numpy: ${#SOS[@]} side modules"
node "$PKG/tools/mismatch.mjs" "${SOS[@]}"
# numpy-wasm-call-signatures.patch fixed the last five (homescoop#1083): any
# mismatch is a wasm trap waiting, so it fails the build.
node "$ROOT/packages/py-kiwisolver/test/wasm-call-signatures.mjs" "${SOS[@]}"
for so in "$SITE/numpy/_core/_multiarray_umath.cpython-315-wasm32-wasix.so" "$SITE/numpy/linalg/_umath_linalg.cpython-315-wasm32-wasix.so"; do
  test -f "$so"
done
grep -E 'NPY_SIZEOF_LONG 4|NPY_SIZEOF_INTP 4' "$SITE/numpy/_core/include/numpy/_numpyconfig.h"
echo "== py-numpy: staged $(du -sh "$DEST" | awk '{print $1}')"
