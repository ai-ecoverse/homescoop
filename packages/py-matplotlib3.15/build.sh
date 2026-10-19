#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe py-matplotlib3.15

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="$WORK/py-matplotlib-$VERSION"
DL="$B/dl"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export SOURCE_DATE_EPOCH=1771459200 PYTHONHASHSEED=0 ZERO_AR_DATE=1
mkdir -p "$DL"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe py-matplotlib3.15 --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe py-matplotlib3.15
MPL_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$MPL_TGZ"

HOSTPY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOSTPY" ]] && command -v python3.15 >/dev/null 2>&1; then
  HOSTPY="$(command -v python3.15)"
fi
if [[ -z "$HOSTPY" ]]; then
  HOSTPY="$B/host/bin/python3.15"
  if [[ ! -x "$HOSTPY" ]]; then
    echo "== py-matplotlib: host CPython 3.15.0 (meson, compileall)"
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
command -v ninja >/dev/null || { echo "homescoop py-matplotlib: need ninja" >&2; exit 1; }

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
[[ "$PYVER" == "$FLOOR" ]] || { echo "homescoop py-matplotlib: headers from wasix-python $PYVER, but the package's range floor is '$FLOOR'" >&2; exit 1; }

# phase B: libc++ headers from the sysroot (-38)
CXXINC="$WASIXCC_SYSROOT_PREFIX/sysroot-ehpic/include/c++/v1"
test -f "$CXXINC/vector"


fetch_src pybind11
PBSITE="$B/pybind11-site"
rm -rf "$PBSITE" && mkdir -p "$PBSITE"
"$HOSTPY" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$SRC_FILE" "$PBSITE"
PBPC="$(dirname "$(find "$PBSITE" -name pybind11.pc | head -1)")"
test -f "$PBPC/pybind11.pc"
fetch_src meson
MESONSITE="$B/meson-site"
rm -rf "$MESONSITE" && mkdir -p "$MESONSITE"
"$HOSTPY" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$SRC_FILE" "$MESONSITE"

SRC="$B/matplotlib-$VERSION"
rm -rf "$SRC"
tar xzf "$MPL_TGZ" -C "$B"
homescoop_apply_patches "$SRC"
# matplotlib's subproject sources, pinned here as in its subprojects/*.wrap;
# meson takes them from packagecache (--wrap-mode=nodownload).
mkdir -p "$SRC/subprojects/packagecache"
for s in freetype harfbuzz libraqm qhull sheenbidi; do
  fetch_src "$s"
  wrap="$SRC/subprojects/$( [[ $s == freetype ]] && echo freetype2 || echo "$s" ).wrap"
  fname="$(sed -n 's/^source_filename = //p' "$wrap")"
  want="$(sed -n 's/^source_hash = //p' "$wrap")"
  got="$(shasum -a 256 "$SRC_FILE" | cut -d' ' -f1)"
  [[ "$got" == "$want" ]] || { echo "homescoop py-matplotlib: $s is $got, $(basename "$wrap") wants $want" >&2; exit 1; }
  cp "$SRC_FILE" "$SRC/subprojects/packagecache/$fname"
  # meson unpacks .tar.xz with Python's lzma module, which the host CPython
  # built here may lack: unpack those with tar and apply the wrap's diff_files
  # as meson would (an existing subproject directory is used as it is).
  if [[ "$fname" == *.tar.xz ]]; then
    dir="$(sed -n 's/^directory = //p' "$wrap")"
    tar xJf "$SRC_FILE" -C "$SRC/subprojects"
    test -d "$SRC/subprojects/$dir"
    for d in $(sed -n 's/^diff_files = //p' "$wrap" | tr ',' ' '); do
      patch -d "$SRC/subprojects/$dir" -p1 -s < "$SRC/subprojects/packagefiles/$d"
    done
  fi
done

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
# matplotlib's meson.build asks `python -m setuptools_scm` for the version; the
# sdist's PKG-INFO has it (setuptools_scm would read the same without git).
mkdir -p "$TOOLS/site/setuptools_scm"
printf 'import re, sys\nprint(re.search(r"^Version: (.+)$", open("PKG-INFO").read(), re.M).group(1))\n' >"$TOOLS/site/setuptools_scm/__main__.py"
: >"$TOOLS/site/setuptools_scm/__init__.py"
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

pkg-config = '$(command -v pkg-config || echo pkg-config)'

[properties]
needs_exe_wrapper = true
skip_sanity_check = true
pkg_config_libdir = '$PBPC'

[built-in options]
c_args = [$FLAGS]
cpp_args = [$FLAGS, '-nostdinc++', '-isystem', '$CXXINC']
c_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined']
cpp_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined']
EOF
cat >"$TOOLS/native.ini" <<EOF
[binaries]
python = '$HOSTPY'
EOF

BUILD="$B/build"
STAGE="$B/stage"
rm -rf "$BUILD" "$STAGE"
export PYTHONPATH="$TOOLS/site:$MESONSITE:$PBSITE"
echo "== py-matplotlib: meson setup"
(cd "$SRC" && "$HOSTPY" -m mesonbuild.mesonmain setup "$BUILD" --cross-file "$TOOLS/cross.ini" --native-file "$TOOLS/native.ini" \
  -Dbuildtype=release -Db_ndebug=if-release -Db_lto=false -Dmacosx=false --wrap-mode=nodownload \
  --prefix=/usr --python.purelibdir=lib/python3.15/site-packages --python.platlibdir=lib/python3.15/site-packages) >"$B/meson-setup.log" 2>&1 \
  || { tail -80 "$B/meson-setup.log" >&2; exit 1; }
grep -E "Run-time dependency pybind11 found: YES" "$B/meson-setup.log" || { tail -40 "$B/meson-setup.log" >&2; exit 1; }
echo "== py-matplotlib: ninja (-j$JOBS)"
ninja -C "$BUILD" -j"$JOBS" >"$B/ninja.log" 2>&1 || { tail -80 "$B/ninja.log" >&2; exit 1; }
(cd "$SRC" && DESTDIR="$STAGE" "$HOSTPY" -m mesonbuild.mesonmain install -C "$BUILD" --no-rebuild --skip-subprojects) >"$B/install.log" 2>&1 \
  || { tail -40 "$B/install.log" >&2; exit 1; }
unset PYTHONPATH
SP="$(dirname "$(find "$STAGE" -type d -path '*/site-packages/matplotlib' | head -1)")"
test -d "$SP/matplotlib"

SITE="$DEST/lib/python3.15/site-packages"
rm -rf "$DEST/lib"
mkdir -p "$SITE"
for d in matplotlib mpl_toolkits pylab.py; do [[ -e "$SP/$d" ]] && cp -R "$SP/$d" "$SITE/$d"; done
test -d "$SITE/mpl_toolkits"
# The test suites' baseline images (2366 files, about 20 MB) stay out, as in
# 3.11.2-9; the tests' .py files ship.
find "$SITE" -type d -name baseline_images -prune -exec rm -rf {} +
find "$SITE" -type d -name __pycache__ -prune -exec rm -rf {} +
find "$SITE" -name '*.so' -exec chmod 755 {} +
DI="$SITE/matplotlib-$VERSION.dist-info"
mkdir -p "$DI/licenses"
cp "$SRC/PKG-INFO" "$DI/METADATA"
cp "$SRC/LICENSE/LICENSE" "$DI/licenses/LICENSE"
printf 'Wheel-Version: 1.0\nGenerator: homescoop (packages/py-matplotlib3.15/build.sh)\nRoot-Is-Purelib: false\nTag: cp315-cp315-wasix_wasm32\n\n' >"$DI/WHEEL"
"$HOSTPY" - "$SITE" "matplotlib-$VERSION.dist-info" <<'PY'
import base64, hashlib, os, sys
site, di = sys.argv[1], sys.argv[2]
rows = []
for top in ("matplotlib", "mpl_toolkits", "pylab.py", di):
    p0 = os.path.join(site, top)
    walk = [(site, [], [top])] if os.path.isfile(p0) else sorted(os.walk(p0))
    for d, _, files in walk:
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
cp "$SRC/LICENSE/LICENSE" "$DEST/LICENSE"
L="$SRC/LICENSE"
SUB="$SRC/subprojects"
WORK="$B" homescoop_notices_begin "matplotlib's side modules compile in FreeType, HarfBuzz, libraqm, SheenBidi, Qhull and Agg, and pybind11's headers; mpl-data ships the fonts below. matplotlib's own licence is LICENSE (PSF-2.0)."
WORK="$B" homescoop_notice "FreeType 2.14.3 (FreeType License, FTL)" "$L/LICENSE_FREETYPE" - "$SUB/freetype-2.14.3/docs/FTL.TXT" -
WORK="$B" homescoop_notice "HarfBuzz 14.1.0 (MIT)" "$L/LICENSE_HARFBUZZ" -
WORK="$B" homescoop_notice "libraqm 0.10.5 (MIT)" "$L/LICENSE_LIBRAQM" -
WORK="$B" homescoop_notice "SheenBidi 3.0.0 (Apache-2.0)" "$L/LICENSE_SHEENBIDI" -
WORK="$B" homescoop_notice "Qhull 8.0.2 (Qhull)" "$(find "$SUB" -maxdepth 2 -path '*qhull-8.0.2/COPYING.txt' | head -1)" -
WORK="$B" homescoop_notice "Agg 2.4 (Anti-Grain Geometry licence, LicenseRef-Agg)" "$SRC/extern/agg24-svn/src/copying" -
WORK="$B" homescoop_notice "pybind11 3.0.1 (BSD-3-Clause)" "$(find "$PBSITE" -name LICENSE -path '*pybind11*' | head -1)" -
WORK="$B" homescoop_notice "BaKoMa fonts (LicenseRef-BaKoMa)" "$L/LICENSE_BAKOMA" -
WORK="$B" homescoop_notice "DejaVu fonts (Bitstream-Vera)" "$SRC/lib/matplotlib/mpl-data/fonts/ttf/LICENSE_DEJAVU" -
WORK="$B" homescoop_notice "STIX fonts (OFL-1.1)" "$L/LICENSE_STIX" -
WORK="$B" homescoop_notice "Last Resort font (OFL-1.1)" "$L/LICENSE_LAST_RESORT_FONT" -
for f in LICENSE_AMSFONTS LICENSE_COLORBREWER LICENSE_COURIERTEN LICENSE_JSXTOOLS_RESIZE_OBSERVER LICENSE_QT4_EDITOR LICENSE_SOLARIZED LICENSE_YORICK; do
  WORK="$B" homescoop_notice "$f (matplotlib LICENSE/$f)" "$L/$f" -
done
homescoop_compile_pyc "$SITE"

mapfile -t SOS < <(find "$SITE" -name '*.cpython-315-wasm32-wasix.so' | sort)
echo "== py-matplotlib: ${#SOS[@]} side modules"
((${#SOS[@]} >= 8)) || { echo "homescoop py-matplotlib: only ${#SOS[@]} side modules" >&2; exit 1; }
node "$ROOT/packages/py-kiwisolver/test/wasm-call-signatures.mjs" "${SOS[@]}" || echo "py-matplotlib: call-signature mismatches above"
echo "== py-matplotlib: staged $(du -sh "$DEST" | awk '{print $1}')"
