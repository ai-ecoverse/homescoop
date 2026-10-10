"""Staging check for wasix-python (homescoop#181): no host artefacts.

Fails on native (ELF/Mach-O) binaries, non-wasm or foreign-suffix extension
modules, platform wheels, and build-machine paths in text files.

    python3 staging-check.py <package dir>
"""
import os
import sys

dest = sys.argv[1]
host_paths = [b"/home/runner", b"/Users/", b"/opt/homebrew"]
if os.environ.get("GITHUB_WORKSPACE"):
    host_paths.append(os.environ["GITHUB_WORKSPACE"].encode())
NATIVE = (b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xce\xfa\xed\xfe", b"\xca\xfe\xba\xbe")
TEXT = (".py", ".pc", ".json", ".txt", ".cfg", ".h", ".pth", ".toml")
bad = []
for root, _dirs, files in os.walk(dest):
    for f in files:
        p = os.path.join(root, f)
        with open(p, "rb") as fh:
            head = fh.read(4)
        if head in NATIVE:
            bad.append(f"native binary: {p}")
        if f.endswith((".so", ".dylib")):
            if head != b"\x00asm":
                bad.append(f"non-wasm shared object: {p}")
            elif not f.endswith(".cpython-314-wasm32-wasix.so"):
                bad.append(f"foreign extension suffix: {p}")
        if f.endswith(".whl") and not f.endswith("-none-any.whl"):
            bad.append(f"platform wheel: {p}")
        if f.endswith(TEXT):
            with open(p, "rb") as fh:
                data = fh.read()
            for hp in host_paths:
                if hp in data:
                    bad.append(f"host path {hp.decode()} in {p}")
if bad:
    print("\n".join(bad[:50]), file=sys.stderr)
    sys.exit(f"staging-check: {len(bad)} host artefacts")
print("staging-check: no native binaries, host paths or platform wheels")
