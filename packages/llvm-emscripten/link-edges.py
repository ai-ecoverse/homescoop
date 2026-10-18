import json
import re
import shlex
import sys
from pathlib import Path

build, out, *tools = sys.argv[1:]
build = Path(build)
lines = (build / "build.ninja").read_text().splitlines()
TARGET = {"clang": "bin/clang.js-24", "lld": "bin/lld.js"}
result = {"tools": {}, "generated": []}
for tool in tools:
    target = TARGET.get(tool, f"bin/{tool}.js")
    for i, line in enumerate(lines):
        if line.startswith(f"build {target}: CXX_EXECUTABLE_LINKER__"):
            break
    else:
        sys.exit(f"link-edges: no link edge for {target}")
    explicit = line.split(":", 1)[1].split("|")[0].split()[1:]
    objects = [o for o in explicit if o.endswith(".o")]
    drivers = [o for o in objects if o.endswith("-driver.cpp.o")]
    if len(drivers) != 1:
        sys.exit(f"link-edges: {target}: expected one generated driver main, got {drivers}")
    attrs = {}
    for attr in lines[i + 1 : i + 40]:
        if not attr.startswith("  "):
            break
        key, _, value = attr.strip().partition(" = ")
        attrs[key] = value
    libs = [l for l in shlex.split(attrs.get("LINK_LIBRARIES", "")) if l.endswith(".a")]
    system = [l for l in shlex.split(attrs.get("LINK_LIBRARIES", "")) if not l.endswith(".a")]
    if any(not re.fullmatch(r"-l[A-Za-z0-9_]+", l) for l in system):
        sys.exit(f"link-edges: {target}: LINK_LIBRARIES has more than archives and -l flags: {system}")
    flags = shlex.split(attrs.get("LINK_FLAGS", ""))
    if any(f.startswith("/") or "/tmp/" in f or "/home/" in f for f in flags):
        sys.exit(f"link-edges: {target}: an absolute path in LINK_FLAGS: {flags}")
    driver_cpp = re.sub(r"/CMakeFiles/[^/]+\.dir/", "/", drivers[0])[: -len(".o")]
    if not (build / driver_cpp).is_file():
        sys.exit(f"link-edges: {target}: generated main {driver_cpp} not found")
    result["tools"][tool] = {
        "target": target,
        "objects": [o for o in objects if o not in drivers],
        "driver": drivers[0],
        "driver_cpp": driver_cpp,
        "libs": libs,
        "system_libs": system,
        "link_flags": flags,
    }
    result["generated"].append(driver_cpp)
Path(out).write_text(json.dumps(result, indent=2) + "\n")
n_obj = len({o for t in result["tools"].values() for o in t["objects"]})
n_lib = len({l for t in result["tools"].values() for l in t["libs"]})
print(f"link-edges: {len(tools)} tools, {n_obj} objects, {n_lib} libraries")
