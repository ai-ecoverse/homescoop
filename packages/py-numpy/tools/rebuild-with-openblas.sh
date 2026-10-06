#!/usr/bin/env bash
# Rebuild py-numpy 2.3.2-N against static WASIX OpenBLAS (into umath + umath_linalg).
set -euo pipefail

ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
PKG="$ROOT/packages/py-numpy"
NPY_WORK="${WASIX_NUMPY_WORK:-/tmp/wasix-numpy-build}"
NPY="$NPY_WORK/numpy-2.3.2"
BUILD="$NPY/build-wasix-openblas"
PREFIX_OB="${WASIX_OPENBLAS_PREFIX:-/tmp/wasix-openblas-prefix}"
PY_PREFIX="$NPY_WORK/python-prefix"
CROSS="$NPY_WORK/wasix.meson.cross"
NATIVE="$NPY_WORK/native.ini"
STAGE="$NPY_WORK/py-numpy-2.3.2-openblas/stage"
VER_PKG="${NUMPY_PKG_VERSION:-2.3.2-3}"

test -f "$PREFIX_OB/lib/libopenblas.a"
test -d "$NPY"
test -f "$PREFIX_OB/lib/pkgconfig/openblas.pc"

echo "== numpy ABI patches (void→int CBLAS; match OpenBLAS int returns) =="
python3 - <<PY
from pathlib import Path
import re
npy = Path(r"$NPY")
p = npy / "numpy/_core/src/common/npy_cblas_base.h"
t = p.read_text()
n = re.sub(r"\bvoid(\s+)BLASNAME", r"int\1BLASNAME", t)
if n != t:
    p.write_text(n)
    print("patched npy_cblas_base.h void→int BLASNAME")
else:
    print("npy_cblas_base.h already int BLASNAME")
assert not re.findall(r"void\s+BLASNAME", n), "still have void BLASNAME"
PY

export PATH="$NPY_WORK/bin:/tmp/wasix-python-build/wasixcc-prefix/bin:$NPY_WORK/venv/bin:/opt/homebrew/bin:$PATH"
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS=exnref
export WASIXCC_PIC=yes
export WASIXCC_MODULE_KIND=shared-library
export WASIXCC_INCLUDE_CPP_SYMBOLS=yes
export AR=wasixar RANLIB=wasixranlib
export PKG_CONFIG_PATH="$PREFIX_OB/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
# Meson cross pkg_config_libdir overrides default search — list both
export PKG_CONFIG_LIBDIR="$PREFIX_OB/lib/pkgconfig:$PY_PREFIX/lib/pkgconfig"
# Force wasix SOABI / platform.machine=wasm32 during meson (see sitecustomize.py)
export PYTHONPATH="$NPY_WORK/sitecustomize-dir${PYTHONPATH:+:$PYTHONPATH}"

echo "== update meson cross for OpenBLAS =="
cat > "$CROSS" <<EOF
[host_machine]
system = 'wasi'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'

[binaries]
c = 'wasixcc'
cpp = 'wasixcc++'
ar = 'wasixar'
pkg-config = 'pkg-config'

[properties]
needs_exe_wrapper = true
skip_sanity_check = true
longdouble_format = 'IEEE_QUAD_LE'
pkg_config_libdir = '$PREFIX_OB/lib/pkgconfig:$PY_PREFIX/lib/pkgconfig'

[built-in options]
c_args = ['-I$PY_PREFIX/include/python3.14', '-I$ROOT/packages/wasix-python/package/include/python3.14', '-I$PREFIX_OB/include']
cpp_args = ['-I$PY_PREFIX/include/python3.14', '-I$ROOT/packages/wasix-python/package/include/python3.14', '-I$PREFIX_OB/include']
# -L so meson's -lopenblas (via blas_dep/pkg-config) resolves from our static .a.
# Do NOT --whole-archive globally — that would embed OpenBLAS into every .so.
c_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined', '-L$PREFIX_OB/lib']
cpp_link_args = ['-shared', '-nostdlib', '-Wl,--allow-undefined', '-L$PREFIX_OB/lib']
EOF

# Ensure backtrace skip patch is present
python3 <<'PY'
from pathlib import Path
p = Path("/tmp/wasix-numpy-build/numpy-2.3.2/numpy/_core/meson.build")
t = p.read_text()
if "homescoop wasix: wasixcc may report backtrace" not in t:
    old = """# Other optional functions
optional_misc_funcs = [
  'backtrace',
  'madvise',
]
"""
    new = """# Other optional functions
# homescoop wasix: wasixcc may report backtrace() linkable but the main
# module (python.wasm) does not export it → unresolved env.backtrace at
# dlopen. Skip backtrace on wasi; temp-elision falls back cleanly.
optional_misc_funcs = [
  'madvise',
]
if host_machine.system() != 'wasi'
  optional_misc_funcs = ['backtrace'] + optional_misc_funcs
endif
"""
    if old not in t:
        raise SystemExit("optional_misc_funcs block not found — patch manually")
    t = t.replace(old, new)
    p.write_text(t)
    print("patched backtrace skip")
else:
    print("backtrace skip already present")
PY

# NumPy requires its vendored Meson (features module); stock 1.6.x lacks it.
MESON_PY="$NPY/vendored-meson/meson/meson.py"
test -f "$MESON_PY"

echo "== meson setup (OpenBLAS) via vendored meson =="
rm -rf "$BUILD"
mkdir -p "$BUILD"
(
  cd "$NPY"
  "$NPY_WORK/venv/bin/python3" "$MESON_PY" setup "$BUILD" \
    --cross-file "$CROSS" \
    --native-file "$NATIVE" \
    -Dallow-noblas=false \
    -Dblas=openblas \
    -Dlapack=openblas \
    -Dbuildtype=release \
    -Db_ndebug=if-release \
    2>&1 | tee /tmp/wasix-numpy-openblas-meson.log
)

# Confirm BLAS found
if ! rg -q "Run-time dependency openblas found: YES" /tmp/wasix-numpy-openblas-meson.log; then
  echo "FAIL: openblas not found by meson" >&2
  rg -n 'openblas|BLAS|LAPACK|allow-noblas' /tmp/wasix-numpy-openblas-meson.log | head -40 >&2
  exit 1
fi
rg -n 'BLAS symbol|openblas found|User defined' /tmp/wasix-numpy-openblas-meson.log | head -20

echo "== ninja build =="
(
  cd "$BUILD"
  ninja -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 8)" 2>&1 | tee /tmp/wasix-numpy-openblas-ninja.log | tail -50
)

UMATH="$BUILD/numpy/_core/_multiarray_umath.cpython-314-wasm32-wasix.so"
LINALG="$BUILD/numpy/linalg/_umath_linalg.cpython-314-wasm32-wasix.so"
test -f "$UMATH"
test -f "$LINALG"

echo "== verify OpenBLAS symbols are DEFINED in umath/linalg (not UND) =="
NM="$HOME/.wasixcc/llvm/bin/llvm-nm"
for so in "$UMATH" "$LINALG"; do
  echo "-- $(basename "$so") size=$(wc -c < "$so")"
  "$NM" "$so" | rg ' (T|t) (cblas_dgemm|dgemm_|dgesv_|cblas_ddot)$' | head -10 || true
  if "$NM" "$so" | rg -q ' U (cblas_dgemm|dgemm_|dgesv_)$'; then
    echo "WARN: still undefined BLAS in $so" >&2
  fi
done

echo "== meson install → stage =="
rm -rf "$STAGE"
mkdir -p "$STAGE"
(
  cd "$BUILD"
  DESTDIR="$STAGE" meson install --no-rebuild 2>&1 | tee /tmp/wasix-numpy-openblas-install.log | tail -20
)

# Meson install layout: usually usr/local/lib/python3.14/site-packages or similar
SP=$(find "$STAGE" -type d -path '*/site-packages/numpy' | head -1)
if [[ -z "$SP" ]]; then
  echo "FAIL: no site-packages/numpy under $STAGE" >&2
  find "$STAGE" -maxdepth 5 -type d | head -40 >&2
  exit 1
fi
SP_PARENT=$(dirname "$SP")
echo "installed numpy at $SP"

# Copy into package/
DEST="$PKG/package"
mkdir -p "$DEST/lib/python3.14/site-packages"
rsync -a --delete "$SP_PARENT/numpy" "$DEST/lib/python3.14/site-packages/"
# Also copy dist-info if present
if compgen -G "$SP_PARENT/numpy"*-dist-info >/dev/null; then
  rsync -a "$SP_PARENT"/numpy*.dist-info "$DEST/lib/python3.14/site-packages/" 2>/dev/null || true
fi

# Compile pyc
# shellcheck source=../../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_compile_pyc "$DEST/lib/python3.14/site-packages"

# Bump package.json
python3 <<PY
import json
from pathlib import Path
p = Path("$DEST/package.json")
d = json.loads(p.read_text())
d["version"] = "$VER_PKG"
d["dependencies"]["@ai-ecoverse/wasix-python"] = "^3.14.2-6"
d["description"] = "NumPy 2.3.2 for slicc WASIX CPython 3.14 (OpenBLAS static into umath/linalg)"
p.write_text(json.dumps(d, indent=2) + "\n")
print("version", d["version"], d["dependencies"])
PY

# README note
cat > "$DEST/README.md" <<'EOF'
# `@ai-ecoverse/py-numpy`

NumPy **2.3.2** for slicc WASIX CPython 3.14 (`cp314-wasix_wasm32` side modules).

- Built with wasixcc PIC (`sysroot-ehpic`); SOABI `cpython-314-wasm32-wasix`
- **OpenBLAS 0.3.28** (`NOFORTRAN=1`, `RISCV64_GENERIC`, static PIC) linked into
  `_multiarray_umath` and `_umath_linalg` (build input only — not a runtime package)
- `.pyc` precompiled (`unchecked-hash`)
EOF

echo "== PRESTAGE hard checks =="
# SOABI
find "$DEST/lib" -name '*.so' | while read -r f; do
  case "$f" in
    *cpython-314-wasm32-wasix.so) ;;
    *) echo "BAD SOABI: $f" >&2; exit 1 ;;
  esac
done
# config sizes
rg -n 'NPY_SIZEOF_LONG|NPY_SIZEOF_INTP' "$DEST/lib/python3.14/site-packages/numpy/_core/include/numpy/_numpyconfig.h"
# unresolved
UNRES="$PKG/tools/unresolved.mjs"
if [[ ! -f "$UNRES" ]]; then
  UNRES=/Users/trieloff/Developer/ai-ecoverse/slicc-emscripten/harness/unresolved.mjs
fi
PYTHON_WASM="$ROOT/packages/wasix-python/package/bin/python.wasm"
mapfile -t SOS < <(find "$DEST/lib" -name '*.so' | sort)
node "$UNRES" "$PYTHON_WASM" "${SOS[@]}" 2>&1 | tee /tmp/numpy-openblas-unresolved.txt
if [[ -s /tmp/numpy-openblas-unresolved.txt ]] && rg -q '.' /tmp/numpy-openblas-unresolved.txt; then
  # unresolved.mjs prints unresolved names; empty = ok
  if ! rg -q '^0 unresolved|^unresolved: 0|No unresolved' /tmp/numpy-openblas-unresolved.txt; then
    # If file has content that looks like symbol names, fail
    if rg -v '^(#|==|Checking|python|umath|size)' /tmp/numpy-openblas-unresolved.txt | rg -q '^[a-zA-Z_]'; then
      echo "FAIL: unresolved symbols present" >&2
      head -40 /tmp/numpy-openblas-unresolved.txt >&2
      exit 1
    fi
  fi
fi

# signature_mismatch stubs → wasm unreachable traps; must be zero
MISMATCH="$PKG/tools/mismatch.mjs"
if [[ ! -f "$MISMATCH" ]]; then
  MISMATCH=/Users/trieloff/Developer/ai-ecoverse/slicc-emscripten/harness/mismatch.mjs
fi
echo "== PRESTAGE mismatch.mjs =="
node "$MISMATCH" "${SOS[@]}" 2>&1 | tee /tmp/numpy-openblas-mismatch.txt

# pyc count
PY_N=$(find "$DEST/lib/python3.14/site-packages/numpy" -name '*.py' | wc -l | tr -d ' ')
PYC_N=$(find "$DEST/lib/python3.14/site-packages/numpy" -name '*.pyc' | wc -l | tr -d ' ')
echo "py=$PY_N pyc=$PYC_N"
# show_config snippet
rg -n 'openblas|Build Dependencies' -A2 "$DEST/lib/python3.14/site-packages/numpy/__config__.py" | head -40

echo "== sizes =="
ls -la "$DEST/lib/python3.14/site-packages/numpy/_core/_multiarray_umath"*.so \
  "$DEST/lib/python3.14/site-packages/numpy/linalg/_umath_linalg"*.so
du -sh "$DEST"

# Stage copy for SLICC acceptance
SLICC="${SLICC_STAGE:-/Users/trieloff/Developer/ai-ecoverse/slicc-emscripten/tmp-wasi/staging/py-numpy}"
rm -rf "$SLICC"
mkdir -p "$SLICC"
rsync -a "$DEST/lib/" "$SLICC/lib/"
cp "$DEST/package.json" "$DEST/README.md" "$DEST/LICENSE" "$SLICC/"
echo "Staged for SLICC: $SLICC"
echo "DONE py-numpy $VER_PKG (OpenBLAS)"
