#!/usr/bin/env bash
# Cross-build SciPy 1.18.0 for WASIX (f2c + static OpenBLAS into extensions).
set -euo pipefail

ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
PKG="$ROOT/packages/py-scipy"
TOOLS="$PKG/tools"
WORK="${WASIX_SCIPY_WORK:-/tmp/wasix-scipy-build}"
SCI="$WORK/scipy-1.18.0"
BUILD="$SCI/build-wasix"
NPY_WORK="${WASIX_NUMPY_WORK:-/tmp/wasix-numpy-build}"
PY_PREFIX="$NPY_WORK/python-prefix"
VENV="$NPY_WORK/venv"
PREFIX_OB="${WASIX_OPENBLAS_PREFIX:-/tmp/wasix-openblas-prefix}"
PREFIX_F2C="${WASIX_LIBF2C_PREFIX:-$WORK/libf2c-prefix}"
WASIXCC_BIN="${WASIXCC_BIN:-/tmp/wasix-python-build/wasixcc-prefix/bin}"
STAGE="$WORK/py-scipy-1.18.0/stage"
VER_PKG="${SCIPY_PKG_VERSION:-1.18.0-4}"
CROSS="$WORK/wasix.meson.cross"
NATIVE="$WORK/native.ini"
SITE_DIR="$WORK/sitecustomize-dir"
BOOST_PREFIX="$(brew --prefix boost 2>/dev/null || true)"

test -d "$SCI/scipy"
test -f "$PREFIX_OB/lib/libopenblas.a"
test -x "$WASIXCC_BIN/wasixcc"
test -x "$VENV/bin/python3"
test -f "$WORK/f2c/src/f2c"

chmod +x "$TOOLS/gfortran" "$TOOLS/wasixcc" "$TOOLS/wasixcc++" "$TOOLS/build-libf2c.sh"

# Copy PRESTAGE checkers from numpy if missing
for f in mismatch.mjs unresolved.mjs; do
  if [[ ! -f "$TOOLS/$f" ]]; then
    cp "$ROOT/packages/py-numpy/tools/$f" "$TOOLS/$f"
  fi
done

echo "== build libf2c =="
bash "$TOOLS/build-libf2c.sh"
test -f "$PREFIX_F2C/lib/libf2c.a"

echo "== wasix_stubs.o (xerbla_array_/HiGHS TLS/MAIN__/pause) =="
"$WASIXCC_BIN/wasixcc" -c -fPIC -fvisibility=default \
  -o "$TOOLS/wasix_stubs.o" "$TOOLS/wasix_stubs.c"
test -f "$TOOLS/wasix_stubs.o"

# Toolchain PATH: our wrappers first, then wasixcc bin, then venv
export PATH="$TOOLS:$WASIXCC_BIN:$VENV/bin:/opt/homebrew/bin:$PATH"
export F2C_PATH="$WORK/f2c/src/f2c"
export F2C_INCLUDE="$PREFIX_F2C/include"
export REAL_GFORTRAN="${REAL_GFORTRAN:-/opt/homebrew/bin/gfortran}"
export WASIX_CC="$TOOLS/wasixcc"
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS=exnref
export WASIXCC_PIC=yes
export WASIXCC_MODULE_KIND=shared-library
export WASIXCC_INCLUDE_CPP_SYMBOLS=yes
export AR=wasixar RANLIB=wasixranlib
export CC="$TOOLS/wasixcc"
export CXX="$TOOLS/wasixcc++"
export FC="$TOOLS/gfortran"
export F77="$TOOLS/gfortran"
export PKG_CONFIG_PATH="/tmp/wasix-scipy-build/pkgconfig:$PREFIX_OB/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
export PKG_CONFIG_LIBDIR="/tmp/wasix-scipy-build/pkgconfig:$PREFIX_OB/lib/pkgconfig:$PY_PREFIX/lib/pkgconfig"
export MESON_RSP_THRESHOLD=131072
# Force wasix SOABI during meson/cython
mkdir -p "$SITE_DIR"
cp "$ROOT/packages/py-numpy/tools/sitecustomize.py" "$SITE_DIR/sitecustomize.py"
export PYTHONPATH="$SITE_DIR${PYTHONPATH:+:$PYTHONPATH}"

echo "== write meson cross / native =="
NPY_INC_HOST="$("$VENV/bin/python3" -c 'import numpy; print(numpy.get_include())')"
NPY_VER_HOST="$("$VENV/bin/python3" -c 'import numpy; print(numpy.__version__)')"
mkdir -p "$WORK/pkgconfig"
cat > "$WORK/pkgconfig/numpy.pc" <<EOF
prefix=$VENV
includedir=$NPY_INC_HOST
Name: numpy
Description: NumPy headers for SciPy WASIX cross build
Version: $NPY_VER_HOST
Cflags: -I\${includedir}
EOF

NPY_INC="$ROOT/packages/py-numpy/package/lib/python3.14/site-packages/numpy/_core/include"
NPY_PKG="$ROOT/packages/py-numpy/package/lib/python3.14/site-packages/numpy"
PY_INC="$PY_PREFIX/include/python3.14"
WASIX_PY_INC="$ROOT/packages/wasix-python/package/include/python3.14"
C_ARGS=(
  "-I$PY_INC" "-I$WASIX_PY_INC" "-I$NPY_INC" "-I$NPY_INC_HOST" "-I$PREFIX_OB/include" "-I$PREFIX_F2C/include"
  "-DNPY_API_SYMBOL_ATTRIBUTE=__attribute__((visibility(\"default\")))"
  "-DUNDERSCORE_G77" "-Wno-return-type" "-fvisibility=default"
)
if [[ -n "$BOOST_PREFIX" ]]; then
  C_ARGS+=("-I$BOOST_PREFIX/include")
fi
# shellcheck disable=SC2086
c_args_json=$(printf "'%s', " "${C_ARGS[@]}")
c_args_json="[${c_args_json%, }]"

cat > "$CROSS" <<EOF
[host_machine]
system = 'wasi'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'

[binaries]
c = '$TOOLS/wasixcc'
cpp = '$TOOLS/wasixcc++'
fortran = '$TOOLS/gfortran'
ar = 'wasixar'
pkg-config = 'pkg-config'
numpy-config = '$VENV/bin/numpy-config'
llvm-config = 'false'

[properties]
needs_exe_wrapper = true
skip_sanity_check = true
longdouble_format = 'IEEE_QUAD_LE'
pkg_config_libdir = '$WORK/pkgconfig:$PREFIX_OB/lib/pkgconfig:$PY_PREFIX/lib/pkgconfig'

[built-in options]
c_args = $c_args_json
cpp_args = $c_args_json
fortran_args = ['-O2']
c_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined', '-L$PREFIX_OB/lib', '-L$PREFIX_F2C/lib']
cpp_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined', '-L$PREFIX_OB/lib', '-L$PREFIX_F2C/lib']
fortran_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined', '-L$PREFIX_OB/lib', '-L$PREFIX_F2C/lib']
EOF

cat > "$NATIVE" <<EOF
[binaries]
python = '$VENV/bin/python3'
fortran = '$TOOLS/gfortran'
numpy-config = '$VENV/bin/numpy-config'
EOF

echo "== ensure ABI sed applied =="
if [[ ! -f "$SCI/.homescoop-abi-sed" ]]; then
  echo "FAIL: run ABI sed first (missing $SCI/.homescoop-abi-sed)" >&2
  exit 1
fi

echo "== no-_ctypes patches (wasix-python has no _ctypes) =="
# Prefer full file copies (continuous_distns is large); fall back to unified diffs.
NOCT="$TOOLS/../patches/no-ctypes"
if [[ -f "$NOCT/_ccallback.py" ]]; then
  cp "$NOCT/_ccallback.py" "$SCI/scipy/_lib/_ccallback.py"
  cp "$NOCT/_ccallback_c.pyx" "$SCI/scipy/_lib/_ccallback_c.pyx"
  cp "$NOCT/_arffread.py" "$SCI/scipy/io/arff/_arffread.py"
  cp "$NOCT/_continuous_distns.py" "$SCI/scipy/stats/_continuous_distns.py"
  echo "applied no-ctypes file copies"
else
  for p in 0006-no-ctypes-_ccallback.py.patch \
           0007-no-ctypes-_ccallback_c.pyx.patch \
           0008-no-ctypes-arffread.py.patch; do
    patch -d "$SCI" -p1 -N < "$TOOLS/../patches/$p" || true
  done
fi

echo "== ABI patches (quadpack no-ctypes C; odr U_fp; DQA) =="
ABI="$TOOLS/../patches/abi"
if [[ -f "$ABI/__quadpack.h" ]]; then
  cp "$ABI/__quadpack.h" "$SCI/scipy/integrate/__quadpack.h"
  cp "$ABI/__odrpack.c" "$SCI/scipy/odr/__odrpack.c"
  echo "applied abi file copies"
fi

# Host pip numpy's npy_cpu.h may only check __EMSCRIPTEN__; wasixcc defines __wasm__.
NPY_CPU_H="$VENV/lib/python3.14/site-packages/numpy/_core/include/numpy/npy_cpu.h"
if [[ -f "$NPY_CPU_H" ]] && ! rg -q 'defined\(__wasm__\)' "$NPY_CPU_H"; then
  echo "== patch host npy_cpu.h for __wasm__ =="
  python3 - "$NPY_CPU_H" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text()
old = "#elif defined(__EMSCRIPTEN__)\n    /* __EMSCRIPTEN__ is defined by emscripten: an LLVM-to-Web compiler */\n    #define NPY_CPU_WASM"
new = "#elif defined(__EMSCRIPTEN__) || defined(__wasm__)\n    /* __EMSCRIPTEN__ is defined by emscripten: an LLVM-to-Web compiler */\n    /* __wasm__ is defined by clang when targeting wasm */\n    #define NPY_CPU_WASM"
if old not in t:
    raise SystemExit(f"npy_cpu.h pattern missing: {p}")
p.write_text(t.replace(old, new, 1))
print("patched", p)
PY
fi

echo "== meson setup =="
rm -rf "$BUILD"
mkdir -p "$BUILD"
(
  cd "$SCI"
  # SciPy uses its own meson; prefer venv meson (<1.10)
  "$VENV/bin/meson" setup "$BUILD" \
    --cross-file "$CROSS" \
    --native-file "$NATIVE" \
    -Dblas=openblas \
    -Dlapack=openblas \
    -Duse-g77-abi=true \
    -Duse-pythran=false \
    -Dc_std=c17 \
    -Dcpp_std=c++17 \
    -Dbuildtype=release \
    -Db_ndebug=if-release \
    2>&1 | tee /tmp/wasix-scipy-meson.log
)

if ! rg -q "Run-time dependency openblas found: YES" /tmp/wasix-scipy-meson.log; then
  echo "FAIL: openblas not found" >&2
  rg -n 'openblas|BLAS|LAPACK|numpy|boost|ERROR' /tmp/wasix-scipy-meson.log | head -60 >&2
  exit 1
fi
rg -n 'openblas found|numpy|boost|g77|Fortran' /tmp/wasix-scipy-meson.log | head -40

echo "== ninja build (this takes a while) =="
(
  cd "$BUILD"
  ninja -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 8)" 2>&1 | tee /tmp/wasix-scipy-ninja.log
)

echo "== meson install → stage =="
rm -rf "$STAGE"
mkdir -p "$STAGE"
(
  cd "$BUILD"
  DESTDIR="$STAGE" meson install --no-rebuild --tags=runtime,python-runtime 2>&1 \
    | tee /tmp/wasix-scipy-install.log | tail -40
)

SP=$(find "$STAGE" -type d -path '*/site-packages/scipy' | head -1)
if [[ -z "$SP" ]]; then
  echo "FAIL: no site-packages/scipy under $STAGE" >&2
  find "$STAGE" -maxdepth 6 -type d | head -50 >&2
  exit 1
fi
SP_PARENT=$(dirname "$SP")
echo "installed scipy at $SP"

DEST="$PKG/package"
mkdir -p "$DEST/lib/python3.14/site-packages"
rsync -a --delete "$SP_PARENT/scipy" "$DEST/lib/python3.14/site-packages/"
if compgen -G "$SP_PARENT/scipy"*-dist-info >/dev/null; then
  rsync -a "$SP_PARENT"/scipy*.dist-info "$DEST/lib/python3.14/site-packages/" 2>/dev/null || true
fi

# Drop tests from ship tree (size + import noise)
find "$DEST/lib/python3.14/site-packages/scipy" -type d -name tests -prune -exec rm -rf {} +
find "$DEST/lib/python3.14/site-packages/scipy" -type d -name 'test_*' -prune -exec rm -rf {} + 2>/dev/null || true

# shellcheck source=../../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_compile_pyc "$DEST/lib/python3.14/site-packages"

python3 <<PY
import json
from pathlib import Path
p = Path("$DEST/package.json")
d = json.loads(p.read_text())
d["version"] = "$VER_PKG"
d["dependencies"]["@ai-ecoverse/wasix-python"] = "^3.14.2-6"
d["dependencies"]["@ai-ecoverse/py-numpy"] = "^2.3.2-4"
d["description"] = "SciPy 1.18.0 for slicc WASIX CPython 3.14 (f2c + OpenBLAS static, zero signature_mismatch)"
p.write_text(json.dumps(d, indent=2) + "\n")
print("version", d["version"])
PY

if [[ ! -f "$DEST/LICENSE" ]]; then
  cp "$SCI/LICENSE.txt" "$DEST/LICENSE" 2>/dev/null || cp "$SCI/LICENSE" "$DEST/LICENSE"
fi

cat > "$DEST/README.md" <<'EOF'
# `@ai-ecoverse/py-scipy`

SciPy **1.18.0** for slicc WASIX CPython 3.14 (`cp314-wasix_wasm32`).

- wasixcc PIC side modules; SOABI `cpython-314-wasm32-wasix`
- Fortran via hoodmane/f2c; **OpenBLAS** static into extensions that need BLAS/LAPACK
- Single int ABI; `-Wl,--fatal-warnings` on real extension links
- `.pyc` precompiled (`unchecked-hash`)
EOF

# Strip ODRPACK extension (import-time wasm trap); ship clean ImportError stub.
rm -f "$DEST"/lib/python3.14/site-packages/scipy/odr/__odrpack.cpython-*.so
cp "$TOOLS/../patches/abi/__odrpack.py.stub" \
  "$DEST/lib/python3.14/site-packages/scipy/odr/__odrpack.py"
DEST="$DEST" python3 - <<'PY'
from pathlib import Path
import os
dest = Path(os.environ["DEST"]) / "lib/python3.14/site-packages/scipy/odr"
msg = "scipy.odr is not available in this build (SLICC wasm)"
p = dest / "_odrpack.py"
t = p.read_text()
needle = "from scipy.odr import __odrpack\n"
guard = f'raise ImportError("{msg}")\n\n'
if needle in t and msg not in t:
    p.write_text(t.replace(needle, guard, 1))
p = dest / "__init__.py"
t = p.read_text()
old = "from ._odrpack import *\n"
new = (
    "try:\n"
    "    from ._odrpack import *  # noqa: F401,F403\n"
    "except ImportError as e:\n"
    f"    raise ImportError({msg!r}) from e\n"
)
if old in t and msg not in t:
    p.write_text(t.replace(old, new, 1))
print("odr stubs applied under", dest)
PY

echo "== PRESTAGE hard checks =="
bad=0
while IFS= read -r f; do
  case "$f" in
    *libscipy_openblas.so) continue ;;
    *cpython-314-wasm32-wasix.so) ;;
    *) echo "BAD SOABI: $f" >&2; bad=1 ;;
  esac
done < <(find "$DEST/lib" -name '*.so')
# Blocking: .so/.py path sets must match previous published package ± allow-list.
# Set SCIPY_PATHSET_PREV to a prior .tgz (or dir). Default: skip if unset.
if [[ -n "${SCIPY_PATHSET_PREV:-}" ]]; then
  echo "== PRESTAGE pathset vs $SCIPY_PATHSET_PREV =="
  "$TOOLS/pathset-check.sh" --prev "$SCIPY_PATHSET_PREV" --cur "$DEST" \
    --allow-add 'scipy/.libs/libscipy_openblas.so' || bad=1
fi
# No macosx wheel tags / renames
if find "$DEST" -iname '*macosx*' | grep -q .; then
  echo "FAIL: macosx artifact present" >&2
  bad=1
fi
# top-level ctypes grep (extensions shouldn't ship ctypes CDLL of libopenblas)
if rg -n "ctypes\.(CDLL|cdll).*openblas|libopenblas\.so" "$DEST/lib/python3.14/site-packages/scipy" -g'*.py' | head; then
  echo "WARN: ctypes openblas references (review)" >&2
fi
# Bare module-level ctypes imports must be guarded (no _ctypes in wasix-python)
if rg -n '^(import ctypes|from ctypes)' "$DEST/lib/python3.14/site-packages/scipy" -g'*.py' --glob '!**/tests/**' | head; then
  echo "FAIL: bare module-level ctypes import in staged .py" >&2
  bad=1
fi
# Source inventory (for PRESTAGE.md): .pyx/.pxi besides guarded fixtures
echo "== ctypes inventory (informational) =="
rg -n 'import ctypes|from ctypes' "$SCI/scipy" -g'*.{py,pyx,pxi}' --glob '!**/tests/**' | head -40 || true

PYTHON_WASM="$ROOT/packages/wasix-python/package/bin/python.wasm"
# unresolved against python.wasm + numpy .so + scipy .so
mapfile -t SOS < <(
  find "$ROOT/packages/py-numpy/package/lib" -name '*.so'
  find "$DEST/lib" -name '*.so' | sort
)
node "$TOOLS/unresolved.mjs" "$PYTHON_WASM" "${SOS[@]}" 2>&1 | tee /tmp/scipy-unresolved.txt
node "$TOOLS/mismatch.mjs" "${SOS[@]}" 2>&1 | tee /tmp/scipy-mismatch.txt

if ! rg -q '^0 signature_mismatch' /tmp/scipy-mismatch.txt; then
  echo "FAIL: signature mismatches" >&2
  bad=1
fi
if ! rg -q '^0 unresolved' /tmp/scipy-unresolved.txt; then
  echo "FAIL: unresolved symbols" >&2
  bad=1
fi

[[ "$bad" -eq 0 ]] || exit 1

PY_N=$(find "$DEST/lib/python3.14/site-packages/scipy" -name '*.py' | wc -l | tr -d ' ')
PYC_N=$(find "$DEST/lib/python3.14/site-packages/scipy" -name '*.pyc' | wc -l | tr -d ' ')
echo "py=$PY_N pyc=$PYC_N"
du -sh "$DEST"

SLICC="${SLICC_STAGE:-/Users/trieloff/Developer/ai-ecoverse/slicc-emscripten/tmp-wasi/staging/py-scipy}"
rm -rf "$SLICC"
mkdir -p "$SLICC"
rsync -a "$DEST/lib/" "$SLICC/lib/"
cp "$DEST/package.json" "$DEST/README.md" "$DEST/LICENSE" "$SLICC/"
echo "Staged for SLICC: $SLICC"
echo "DONE py-scipy $VER_PKG"
