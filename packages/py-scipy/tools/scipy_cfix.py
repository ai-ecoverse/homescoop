"""Pyodide's int-return fixes for scipy's generated C (homescoop#211 A6).

wasix-openblas' LAPACK is f2c output: every subroutine returns int. wasm calls
are type-checked, so f2py's and Cython's `void` declarations of those routines
must say `int` too. These files are generated during the build (not in the
sdist), so a patch can't do it; the cc wrapper runs fix(path) on each one
before compiling. From pyodide-build's _f2c_fixes.py (scipy_fix_cfile, MPL-2.0).

    python3 scipy_cfix.py <file.c>...
    python3 scipy_cfix.py --tree <scipy source dir>
    python3 scipy_cfix.py --cyutility <_cyutility.c>

--tree does the same for scipy's own sources before the build: every
`void BLAS_FUNC(x)(...);`, `void F_FUNC(x,X)(...);`, `void CBLAS_FUNC(x)(...);`
or `void ARNAUD_BLAS(x)(...);` (ARPACK's) prototype (a declaration, not a definition) is declared int.
"""
import re
import sys
from pathlib import Path


PROTO = re.compile(r"\bvoid(\s+(?:BLAS_FUNC|F_FUNC|CBLAS_FUNC|ARNAUD_BLAS)\s*\([^()]*\)\s*\([^;{]*\)\s*;)")


def find_header(source_dir: Path, header_name: str) -> Path:
    while not (header_path := source_dir / header_name).exists():
        # meson copies the source files into a subdirectory of the build
        source_dir = source_dir.parent
        if source_dir == Path("/"):
            raise RuntimeError(f"Could not find header file {header_name}")
    return header_path


def fix(path: Path) -> None:
    text = path.read_text()
    text = text.replace("extern void F_WRAPPEDFUNC", "extern int F_WRAPPEDFUNC")
    text = text.replace("extern void F_FUNC", "extern int F_FUNC")
    text = text.replace("void (*f2py_func)", "int (*f2py_func)")
    text = text.replace("static void cb_", "static int cb_")
    text = text.replace("typedef void(*cb_", "typedef int(*cb_")
    text = text.replace("void(*)", "int(*)")
    text = text.replace("static void f2py_setup_", "static int f2py_setup_")
    # Cython's __Pyx_IsSameCFunction casts stay void(*)(void).
    text = re.sub(r"(__Pyx_IsSameCFunction\([^,]+,\s*)\(int\(\*\)\(void\)\)", r"\1(void(*)(void))", text)
    if path.name.endswith("_flapackmodule.c"):
        # C LAPACK takes no hidden Fortran string lengths.
        text = text.replace(",size_t", "")
        text = re.sub(r",slen\([a-z]*\)\)", ")", text)
    text = PROTO.sub(r"int\1", text)
    path.write_text(text)
    for lib in ["lapack", "blas"]:
        if path.name.endswith(f"cython_{lib}.c"):
            header_path = find_header(path.parent, f"_{lib}_subroutines.h")
            header_text = header_path.read_text().replace("void F_FUNC", "int F_FUNC")
            header_path.write_text(PROTO.sub(r"int\1", header_text))




def fix_tree(root: Path) -> int:
    n = 0
    for p in sorted(root.rglob("*")):
        if p.suffix not in (".c", ".h", ".cc", ".hh", ".cpp", ".hpp", ".cxx") or "tests" in p.parts:
            continue
        text = p.read_text(errors="surrogateescape")
        new, k = PROTO.subn(r"int\1", text)
        if k:
            p.write_text(new, errors="surrogateescape")
            n += k
            print(f"scipy_cfix: {p.relative_to(root)}: {k} prototype(s) void -> int")
    return n


def fix_cyutility(path: Path) -> None:
    """Cython's --generate-shared writes _cyutility.pyx into a fresh mkdtemp()
    directory and the C names it in its traceback strings, so two builds
    differ (reproducible job). Name it without the temporary directory."""
    text = path.read_text()
    path.write_text(re.sub(r'"[^"\n]*?tmp[A-Za-z0-9_]{8}/_cyutility\.pyx"', '"_cyutility.pyx"', text))


if __name__ == "__main__":
    if sys.argv[1:2] == ["--cyutility"]:
        for a in sys.argv[2:]:
            fix_cyutility(Path(a))
    elif sys.argv[1:2] == ["--tree"]:
        print(f"scipy_cfix: {fix_tree(Path(sys.argv[2]))} prototypes in all")
    else:
        for a in sys.argv[1:]:
            fix(Path(a))
