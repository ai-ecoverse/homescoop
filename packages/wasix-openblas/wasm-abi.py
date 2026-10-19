#!/usr/bin/env python3
"""OpenBLAS 0.3.34 source edits for wasm32-wasix (run in the source tree).

The same edits as packages/py-numpy/tools/build-openblas.sh, after Pyodide:
- ctest.c / common.h: wasi is an RISCV64_GENERIC target with an empty
  YIELDING;
- the f2c int ABI: every Fortran-style BLAS/LAPACK entry returns int
  (void -> int in common_interface.h, cblas.h, interface/*.c and the
  f2c'd lapack-netlib SRC, the complex dotc/dotu/ladiv helpers stay void),
  since caller and callee must agree (wasm-ld links a trapping stub for a
  signature mismatch);
- xerbla_ takes (char *, blasint *), as numpy's python_xerbla does;
- Makefile.riscv64 loses its -march/-mabi flags.
"""
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
# 0.3.32 moved emscripten to its own ARCH_WASM (an empty YIELDING there), and
# ARCH_RISCV64's YIELDING is a nop asm that wasm can't assemble: define the
# empty one for wasi ahead of the RISCV64 block. (<= 0.3.31: the
# __EMSCRIPTEN__ block.)
old_y = "#ifdef __EMSCRIPTEN__\n#define YIELDING\n#endif"
new_y = "#if defined(__EMSCRIPTEN__) || defined(__wasi__)\n#define YIELDING\n#endif"
rv_y = "#if defined(ARCH_RISCV64)\n#ifndef YIELDING\n"
wasi_y = "#if defined(__wasi__)\n#define YIELDING\n#endif\n\n"
if new_y in t or wasi_y + rv_y in t:
    print("common.h YIELDING already covers wasi")
elif old_y in t:
    t = t.replace(old_y, new_y)
    print("patched common.h: YIELDING for wasi")
elif t.count(rv_y) == 1:
    t = t.replace(rv_y, wasi_y + rv_y)
    print("patched common.h: YIELDING for wasi (before ARCH_RISCV64)")
else:
    raise SystemExit("common.h: no YIELDING block to patch for wasi")
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

# lapack/**/*.c (OpenBLAS's own LAPACK, e.g. 0.3.34's lapack/laed3, which
# replaces netlib's ?laed3_): file-scope prototypes of the f2c'd netlib
# routines it calls (void LAED4/LACPY/LASET(...);) → int, or the
# --whole-archive link sees a signature mismatch and dsyevd_ traps (#1173).
proto_void = re.compile(r"^(\s*(?:extern\s+)?)void(\s+[A-Z][A-Z0-9_]*\s*\([^)]*\)\s*;)", re.M)
nl = 0
for p in Path("lapack").rglob("*.c"):
    if patch_text(p, lambda t: proto_void.sub(r"\1int\2", t)):
        nl += 1
print(f"patched lapack/**/*.c prototypes: {nl}")

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
        n2, k = re.subn(
            r"xerbla_\(\s*([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s*,\s*\(ftnlen\)\s*strlen\([a-zA-Z0-9_]+\)\s*\)",
            r"xerbla_(\1, \2)",
            n2,
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

# Makefile.riscv64 injects -march=rv64* / -mabi=lp64d: drop them for wasm.
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

# xerbla_ and xerbla_array_ are weak, so a program's own wins without a
# duplicate symbol: numpy's python_xerbla (xerbla_) and scipy's
# wasix_stubs.c (xerbla_array_). driver/others/xerbla.c makes xerbla_ a weak
# alias only on ELF; wasm takes its #else branch, which defines it strong.
def weaken(path: Path, old: str, new: str) -> None:  # replace once, idempotent
    t = path.read_text(errors="replace")
    if new in t:
        return
    if old not in t:
        raise SystemExit(f"{path}: no {old!r} to make weak")
    path.write_text(t.replace(old, new, 1))
    print(f"edited: {path}")

# 0.3.34's xerbla.c dispatches to an openblas_set_xerbla handler and takes
# the name length as a third argument; the 2-arg ABI has no length, so it
# passes strlen (the names are C string literals). (<= 0.3.33: the plain
# printf #else branch.)
X34_OLD = ("#else\nint BLASFUNC(xerbla)(char *message, blasint *info, blasint length) {\n"
           "  return openblas_xerbla_dispatch(message, info, length);\n}\n#endif")
X34_NEW = ("#else\n__attribute__((weak)) int BLASFUNC(xerbla)(char *message, blasint *info) {\n"
           "  return openblas_xerbla_dispatch(message, info, message ? (blasint)strlen(message) : 0);\n}\n#endif")
p = Path("driver/others/xerbla.c")
if "openblas_xerbla_dispatch" in p.read_text():
    weaken(p, X34_OLD, X34_NEW)
else:
    weaken(p,
           "#else\n\nint BLASFUNC(xerbla)(char *message, blasint *info){",
           "#else\n\n__attribute__((weak)) int BLASFUNC(xerbla)(char *message, blasint *info){")
weaken(Path("lapack-netlib/SRC/xerbla_array.c"),
       "/* Subroutine */ int xerbla_array_(",
       "/* Subroutine */ __attribute__((weak)) int xerbla_array_(")

# OS_EMBEDDED (COMMON_OPT, for the malloc-only allocator without mmap/shm)
# also defines stub puts/printf/getenv/atoi in memory.c for bare-metal
# targets. wasix has a libc: those stubs would clash with it (duplicate
# symbols) or silently replace it in a side module.
weaken(Path("driver/others/memory.c"),
       "#define ALLOC_MALLOC\n\ninline int puts(const char *str) { return 0; }\ninline int printf(const char *format, ...) { return 0; }\ninline char *getenv(const char *name) { return \"\"; }\ninline int atoi(const char *str) { return 0; }\n#endif",
       "#define ALLOC_MALLOC\n\n#ifndef __wasi__\ninline int puts(const char *str) { return 0; }\ninline int printf(const char *format, ...) { return 0; }\ninline char *getenv(const char *name) { return \"\"; }\ninline int atoi(const char *str) { return 0; }\n#endif\n#endif")
