#!/usr/bin/env bash
# Build static PIC OpenBLAS for WASIX (build input only — not an npm runtime package).
# Mirrors Pyodide: NOFORTRAN=1, TARGET=RISCV64_GENERIC, C kernels, single-thread,
# f2c netlib LAPACK, void→int ABI (caller and callee must agree — wasm-ld mismatch
# stubs are `unreachable` traps).
set -euo pipefail

ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../../.." && pwd)}"
WORK="${WASIX_OPENBLAS_WORK:-/tmp/wasix-openblas-build}"
PREFIX="${WASIX_OPENBLAS_PREFIX:-/tmp/wasix-openblas-prefix}"
VER="${OPENBLAS_VERSION:-0.3.28}"
SRC="$WORK/OpenBLAS-$VER"
TARBALL="$WORK/OpenBLAS-$VER.tar.gz"
URL="https://github.com/OpenMathLib/OpenBLAS/releases/download/v${VER}/OpenBLAS-${VER}.tar.gz"

# Use the real wasixcc toolchain only — never the numpy shared-lib wrappers.
WASIXCC_BIN="${WASIXCC_PREFIX:-/tmp/wasix-python-build/wasixcc-prefix}/bin"
export PATH="$WASIXCC_BIN:/usr/bin:/bin:/opt/homebrew/bin"
# Drop ambient wasix/numpy link env that breaks HOSTCC (Apple clang honors CCC_OVERRIDE_OPTIONS).
unset CCC_OVERRIDE_OPTIONS || true
unset WASIXCC_MODULE_KIND WASIXCC_INCLUDE_CPP_SYMBOLS || true
unset PKG_CONFIG_LIBDIR PKG_CONFIG_PATH PYTHONPATH || true
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS="${WASIXCC_WASM_EXCEPTIONS:-legacy}"
export WASIXCC_PIC=yes
export HOSTCC="${HOSTCC:-/usr/bin/cc}"
export CXX=wasixcc++
export AR=wasixar
export RANLIB=wasixranlib

mkdir -p "$WORK"
# Strip RISC-V -march/-mabi that Makefile.riscv64 adds (invalid for wasm32-wasi).
OB_WRAP="$WORK/wasixcc-openblas"
cat > "$OB_WRAP" <<'WRAP'
#!/usr/bin/env bash
args=()
for a in "$@"; do
  case "$a" in
    -march=*|-mabi=*|-mtune=*) continue ;;
  esac
  args+=("$a")
done
exec wasixcc "${args[@]}"
WRAP
chmod +x "$OB_WRAP"
export CC="$OB_WRAP"

if [[ ! -f "$TARBALL" ]]; then
  curl -fsSL -o "$TARBALL" "$URL"
fi
# Always start from a clean extract so ABI patches apply to pristine sources.
rm -rf "$SRC"
tar -xzf "$TARBALL" -C "$WORK"
cd "$SRC"

echo "== WASIX / wasm32 source patches =="
python3 - <<'PY'
from pathlib import Path
import re

# ctest.c: treat wasi like emscripten for ARCH probe
p = Path("ctest.c")
t = p.read_text()
if "defined(__wasi__)" not in t:
    t = t.replace(
        "#if defined(__EMSCRIPTEN__)\nARCH_RISCV64\n#endif",
        "#if defined(__EMSCRIPTEN__) || defined(__wasi__)\nARCH_RISCV64\n#endif",
    )
    if "defined(__wasi__)" not in t:
        t += "\n#if defined(__wasi__)\nARCH_RISCV64\n#endif\n"
    p.write_text(t)
    print("patched ctest.c")

# common.h: wasi needs empty YIELDING (no sched_yield) and must NOT include
# sys/shm.h. We pass -DOS_EMBEDDED in COMMON_OPT for the shm/mmap branch.
p = Path("common.h")
t = p.read_text()
t = t.replace(
    "#elif !defined(OS_EMBEDDED) || defined(__wasi__)",
    "#elif !defined(OS_EMBEDDED)",
)
old_y = "#ifdef __EMSCRIPTEN__\n#define YIELDING\n#endif"
new_y = "#if defined(__EMSCRIPTEN__) || defined(__wasi__)\n#define YIELDING\n#endif"
if new_y not in t:
    if old_y not in t:
        raise SystemExit("YIELDING emscripten block not found")
    t = t.replace(old_y, new_y)
    print("patched common.h: YIELDING for wasi")
else:
    print("common.h YIELDING already covers wasi")
p.write_text(t)
assert "#elif !defined(OS_EMBEDDED) || defined(__wasi__)" not in t

# --- Pyodide ABI: every Fortran-style BLAS/LAPACK entry returns int (f2c). ---
# BSD sed cannot run Pyodide's sed -ri recipes; do it in Python.

def patch_text(path: Path, fn):
    t = path.read_text(errors="replace")
    n = fn(t)
    if n != t:
        path.write_text(n)
        return True
    return False

# common_interface.h: void BLASFUNC → int BLASFUNC
n = 0
if patch_text(Path("common_interface.h"), lambda t: re.sub(r"void(\s+)BLASFUNC", r"int\1BLASFUNC", t)):
    n += 1
    print("patched common_interface.h BLASFUNC")

# cblas.h + ctest: void cblas_ → int cblas_
for p in [Path("cblas.h"), *Path("ctest").glob("*.c")]:
    if p.is_file() and patch_text(p, lambda t: re.sub(r"void(\s+)cblas_", r"int\1cblas_", t)):
        n += 1
print(f"patched cblas headers/tests: {n}")

# interface/*.c: void NAME / void CNAME → int
ni = 0
for p in Path("interface").glob("*.c"):
    if patch_text(p, lambda t: re.sub(r"void(\s+)(C?NAME)", r"int\1\2", t)):
        ni += 1
print(f"patched interface/*.c: {ni}")

# lapack-netlib SRC: void foo_ → int foo_ (definitions and extern decls)
# Then revert complex helpers that f2c truly returns as void.
void_to_int = re.compile(r"((?:extern)?.+?) void ([a-z0-9]+_)")
revert = re.compile(r"int ([cz](?:dotc|dotu|ladiv))")

def patch_lapack_c(t: str) -> str:
    t = void_to_int.sub(r"\1 int \2", t)
    t = revert.sub(r"void \1", t)
    return t

nlap = 0
for sub in [Path("lapack-netlib/SRC"), Path("lapack-netlib/SRC/DEPRECATED")]:
    if not sub.is_dir():
        continue
    for p in sub.glob("*.c"):
        if patch_text(p, patch_lapack_c):
            nlap += 1
print(f"patched lapack-netlib SRC: {nlap} files")

# MATGEN (tmglib) — patch too, but we strip these objects from the final .a
nmat = 0
matgen = Path("lapack-netlib/TESTING/MATGEN")
if matgen.is_dir():
    for p in matgen.glob("*.c"):
        if patch_text(p, patch_lapack_c):
            nmat += 1
print(f"patched MATGEN: {nmat} files")

# Remaining void foo_( should be only the reverted complex helpers
remain = 0
samples = []
for p in Path("lapack-netlib/SRC").glob("*.c"):
    for m in re.finditer(r"void ([a-z0-9]+_)\(", p.read_text(errors="replace")):
        remain += 1
        if len(samples) < 8:
            samples.append(m.group(1))
print(f"remaining void foo_( in SRC: {remain} samples={samples}")

# xerbla_: numpy python_xerbla is 2-arg; drop f2c ftnlen from OpenBLAS LAPACK
xerbla_files = 0
xerbla_calls = 0
for sub in [Path("lapack-netlib/SRC"), Path("lapack-netlib/SRC/DEPRECATED"), Path("lapack-netlib/TESTING/MATGEN")]:
    if not sub.is_dir():
        continue
    for p in sub.glob("*.c"):
        t = p.read_text(errors="replace")
        n = t
        # decls: xerbla_(char *, integer *, ftnlen) → 2-arg
        n = re.sub(
            r"xerbla_\(\s*char\s*\*\s*,\s*integer\s*\*\s*,\s*ftnlen\s*\)",
            "xerbla_(char *, integer *)",
            n,
        )
        # calls: xerbla_("NAME", &i, (ftnlen)N) → xerbla_("NAME", &i)
        n2, k = re.subn(
            r"xerbla_\(\s*(\"[^\"]*\"\s*,\s*&?[a-zA-Z0-9_]+)\s*,\s*(?:\(ftnlen\)\s*)?\d+\s*\)",
            r"xerbla_(\1)",
            n,
        )
        xerbla_calls += k
        # common_interface style in comments etc.
        if n2 != t:
            p.write_text(n2)
            xerbla_files += 1
print(f"patched xerbla ftnlen away: files={xerbla_files} calls={xerbla_calls}")

# common_interface.h xerbla 3-arg → 2-arg
p = Path("common_interface.h")
t = p.read_text()
n = re.sub(
    r"int\s+BLASFUNC\(xerbla\)\(char\s*\*\s*,\s*blasint\s*\*info\s*,\s*blasint\)",
    r"int    BLASFUNC(xerbla)(char *, blasint *info)",
    t,
)
if n != t:
    p.write_text(n)
    print("patched common_interface.h xerbla → 2-arg")

# OpenBLAS interface calls xerbla with sizeof(name)[, -1] as 3rd arg — drop it.
xerbla_iface = 0
pat = re.compile(
    r"BLASFUNC\(xerbla\)\s*\(\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*sizeof\s*\([^)]+\)\s*(?:-\s*\d+)?\s*\)"
)
for p in Path("interface").rglob("*.c"):
    t = p.read_text()
    nt, k = pat.subn(r"BLASFUNC(xerbla)(\1, \2)", t)
    if k:
        p.write_text(nt)
        xerbla_iface += k
print(f"patched interface xerbla 3→2-arg calls: {xerbla_iface}")

# driver/others/xerbla.c definition must match 2-arg decl
p = Path("driver/others/xerbla.c")
if p.is_file():
    t = p.read_text()
    n = t
    n = n.replace(
        "int __xerbla(char *message, blasint *info, blasint length){",
        "int __xerbla(char *message, blasint *info){",
    )
    n = n.replace(
        'int BLASFUNC(xerbla)(char *, blasint *, blasint) __attribute__ ((weak, alias ("__xerbla")));',
        'int BLASFUNC(xerbla)(char *, blasint *) __attribute__ ((weak, alias ("__xerbla")));',
    )
    n = n.replace(
        "int BLASFUNC(xerbla)(char *message, blasint *info, blasint length){",
        "int BLASFUNC(xerbla)(char *message, blasint *info){",
    )
    if n != t:
        p.write_text(n)
        print("patched driver/others/xerbla.c → 2-arg")
PY
if ! grep -q '^COMMON_OPT = -O2 -Wno-return-type' Makefile.rule; then
  cp -n Makefile.rule Makefile.rule.orig || true
  # macOS sed: -i needs extension arg
  sed -i.bak 's|^# COMMON_OPT = -O2|COMMON_OPT = -O2 -Wno-return-type|' Makefile.rule
fi

# Makefile.riscv64 injects -march=rv64* / -mabi=lp64d — drop for wasm.
python3 - <<'PY'
from pathlib import Path
import re
p = Path("Makefile.riscv64")
t = p.read_text()
n = re.sub(r"CCOMMON_OPT \+= -march=\S+(?: -mabi=\S+)?(?: -mtune=\S+)?(?: -ffast-math)?",
           "CCOMMON_OPT += -DOS_EMBEDDED", t)
n = re.sub(r"FCOMMON_OPT \+= -march=\S+(?: -mabi=\S+)?(?: -mtune=\S+)?(?: -static)?",
           "FCOMMON_OPT +=", n)
if n != t:
    p.write_text(n)
    print("patched Makefile.riscv64: removed -march/-mabi")
else:
    print("Makefile.riscv64: no -march lines to patch (already clean?)")
PY

# Shared make knobs (CC must be the -march-stripping wrapper, not bare wasixcc)
OB_MAKE=(
  CC="$OB_WRAP" HOSTCC="$HOSTCC"
  TARGET=RISCV64_GENERIC
  BINARY=32
  NOFORTRAN=1
  USE_THREAD=0
  NUM_THREADS=1
  NO_SHARED=1
  NO_LAPACKE=1
  CROSS=1
  COMMON_OPT="-O2 -Wno-return-type -fPIC -DOS_EMBEDDED -DMAX_STACK_ALLOC=2048"
)

echo "== OpenBLAS: make libs (BLAS) =="
make clean >/dev/null 2>&1 || true
make -j"$(sysctl -n hw.ncpu 2>/dev/null || echo 8)" \
  "${OB_MAKE[@]}" ONLY_CBLAS=0 libs

echo "== OpenBLAS: make netlib (f2c LAPACK) =="
# netlib can OOM at high -j on this host; keep modest then fall back
make -j4 "${OB_MAKE[@]}" netlib || make -j1 "${OB_MAKE[@]}" netlib

LIBA=$(ls -1 libopenblas*.a | head -1)
test -f "$LIBA"

echo "== strip xerbla*.o (numpy provides python_xerbla) and tmglib =="
"$AR" t "$LIBA" | grep -E "^(xerbla|cblas_xerbla|[sdcz]latm|[sdcz]lagge|[sdcz]lagsy|[sdcz]laghe|[sdcz]lahilb|[sdcz]laran|[sdcz]latme|[sdcz]latmr|[sdcz]latmt|[sdcz]latms|[sdcz]lakf2|[sdcz]large|[sdcz]laror|[sdcz]larot|[sdcz]larnd)" > /tmp/ob-strip-$$.txt || true
if [[ -s /tmp/ob-strip-$$.txt ]]; then
  # xargs batches: wasixar d archive.a obj...
  xargs -n 40 "$AR" d "$LIBA" < /tmp/ob-strip-$$.txt
  echo "stripped $(wc -l < /tmp/ob-strip-$$.txt | tr -d " ") objects"
fi
rm -f /tmp/ob-strip-$$.txt

echo "== OpenBLAS: install prefix $PREFIX (static only) =="
rm -rf "$PREFIX"
mkdir -p "$PREFIX/lib/pkgconfig" "$PREFIX/include"
cp -f "$LIBA" "$PREFIX/lib/libopenblas.a"
cp -f cblas.h "$PREFIX/include/"
[[ -f f77blas.h ]] && cp -f f77blas.h "$PREFIX/include/" || true
if [[ -f openblas_config.h ]]; then
  cp -f openblas_config.h "$PREFIX/include/"
else
  make -f Makefile.install install PREFIX="$PREFIX" NO_SHARED=1 LIBNAMESUFFIX= 2>/dev/null || true
  [[ -f "$PREFIX/include/openblas_config.h" ]] || cp config.h "$PREFIX/include/openblas_config.h"
fi

# Ensure installed cblas.h has int returns (Makefile.install may regenerate)
python3 - <<PY
from pathlib import Path
import re
p = Path("$PREFIX/include/cblas.h")
t = p.read_text()
n = re.sub(r"void(\\s+)cblas_", r"int\\1cblas_", t)
p.write_text(n)
print("cblas.h void cblas_ count:", len(re.findall(r"void\\s+cblas_", n)))
PY
cat > "$PREFIX/lib/pkgconfig/openblas.pc" <<EOF
prefix=$PREFIX
exec_prefix=\${prefix}
libdir=\${exec_prefix}/lib
includedir=\${prefix}/include

Name: openblas
Description: OpenBLAS WASIX static PIC (NOFORTRAN=1, RISCV64_GENERIC, f2c netlib, int ABI)
Version: $VER
URL: http://www.openblas.net/
Libs: -L\${libdir} -lopenblas -lm
Libs.private: -lm
Cflags: -I\${includedir}
openblas_config=USE_THREAD=0 NO_LAPACKE NO_AFFINITY RISCV64_GENERIC INT_ABI
EOF
for n in blas lapack cblas; do
  cp "$PREFIX/lib/pkgconfig/openblas.pc" "$PREFIX/lib/pkgconfig/$n.pc"
done

echo "== OpenBLAS: verify symbols =="
NM="$HOME/.wasixcc/llvm/bin/llvm-nm"
[[ -x "$NM" ]] || NM=llvm-nm
"$NM" "$PREFIX/lib/libopenblas.a" | grep -E ' T (cblas_dgemm|dgemm_|dgesv_|dgesvd_)$' | head
# xerbla must NOT be defined in the archive
if "$NM" "$PREFIX/lib/libopenblas.a" | grep -E ' T xerbla_?$'; then
  echo "FAIL: xerbla still defined in libopenblas.a" >&2
  exit 1
fi
du -sh "$PREFIX/lib/libopenblas.a"
echo "OpenBLAS prefix ready: $PREFIX"
