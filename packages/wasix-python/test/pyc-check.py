"""Every .py under lib/python3.14 has its unchecked-hash .pyc (homescoop#181).

    python3.14 pyc-check.py <lib/python3.14>

Files compileall cannot compile (syntax only valid for other versions, e.g.
lib2to3 test data) are listed and allowed only if they fail to compile here
too.
"""
import importlib.util
import os
import sys

root = sys.argv[1]
missing = []
for d, _dirs, files in os.walk(root):
    for f in files:
        if not f.endswith(".py"):
            continue
        py = os.path.join(d, f)
        pyc = importlib.util.cache_from_source(py)
        if os.path.exists(pyc):
            with open(pyc, "rb") as fh:
                flags = int.from_bytes(fh.read(8)[4:8], "little")
            if flags != 0b01:  # hash-based, unchecked
                missing.append(f"{py}: pyc flags {flags}")
            continue
        try:
            with open(py, "rb") as fh:
                compile(fh.read(), py, "exec")
        except SyntaxError:
            continue
        missing.append(f"{py}: no pyc")
if missing:
    print("\n".join(missing[:40]), file=sys.stderr)
    sys.exit(f"pyc-check: {len(missing)} problems")
print("pyc-check: every compilable .py has an unchecked-hash .pyc")
