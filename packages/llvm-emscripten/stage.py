import hashlib
import json
import os
import re
import shlex
import shutil
import sys
from pathlib import Path

src, build, edges_path, pkg, commit, em_tree, em_cache, patches, llvm_patches = sys.argv[1:]
src, build, pkg, em_tree, em_cache, patches, llvm_patches = map(Path, (src, build, pkg, em_tree, em_cache, patches, llvm_patches))
edges = json.loads(Path(edges_path).read_text())


def copy(a, b):
    b.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(a, b)


alltypes = em_cache / "sysroot/include/bits/alltypes.h"
text = alltypes.read_text()
if "__bits[128/sizeof(long)]" not in text or "__bits[2]" in text:
    sys.exit(f"stage: {alltypes} is not the 128-byte sigset_t")

digest = hashlib.sha256()
for p in sorted(patches.glob("*.patch")):
    digest.update(p.name.encode() + b"\0" + p.read_bytes() + b"\0")

manifest = {
    "package": "@ai-ecoverse/llvm-emscripten",
    "llvm_commit": commit,
    "llvm_version": "24.0.0git",
    "emscripten": {"tag": "6.0.9", "commit": "4e4223852a0835923411059a3929907d7df1232e"},
    "emsdk_release": "f04ea239d533260dd1db760dd2d668d5f9a88d6b",
    "wasm_emscripten_patches_sha256": digest.hexdigest(),
    "wasm_emscripten_patches": sorted(p.name for p in patches.glob("*.patch")),
    "llvm_patches": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(llvm_patches.glob("*.patch"))},
    "sysroot": {"sigset_t": "128-byte (musl alltypes.h __bits[128/sizeof(long)])"},
    "config": {
        "CMAKE_BUILD_TYPE": "Release",
        "LLVM_ENABLE_PROJECTS": "clang;lld",
        "LLVM_TARGETS_TO_BUILD": "WebAssembly",
        "LLVM_HOST_TRIPLE": "wasm32-unknown-emscripten",
        "LLVM_DEFAULT_TARGET_TRIPLE": "",
        "LLVM_ENABLE_THREADS": "OFF",
        "LLVM_ENABLE_LTO": "OFF",
        "LLVM_ENABLE_EH": "OFF",
        "LLVM_ENABLE_RTTI": "OFF",
        "LLVM_ENABLE_PIC": "OFF",
        "debug_info": "-g0",
    },
    "eh": "js",
    "tools": {},
}

libs_seen = set()
for tool, edge in edges["tools"].items():
    objs = []
    for o in edge["objects"]:
        copy(build / o, pkg / "objects" / o)
        objs.append(f"objects/{o}")
    libs = []
    for lib in edge["libs"]:
        name = Path(lib).name
        if name not in libs_seen:
            copy(build / lib, pkg / "lib" / name)
            libs_seen.add(name)
        libs.append(f"lib/{name}")
    driver = Path(edge["driver_cpp"]).name
    copy(build / edge["driver_cpp"], pkg / "drivers" / driver)
    init = re.search(r"InitLLVM X\([^;]*", (build / edge["driver_cpp"]).read_text())
    manifest["tools"][tool] = {
        "objects": objs,
        "libs": libs,
        "system_libs": edge["system_libs"],
        "link_flags": edge["link_flags"],
        "driver_cpp": f"drivers/{driver}",
        "init_llvm": init.group(0) if init else None,
    }

shutil.copytree(src / "llvm/include", pkg / "include", dirs_exist_ok=True)
shutil.copytree(build / "include", pkg / "include", dirs_exist_ok=True)
for junk in pkg.joinpath("include").rglob("*"):
    if junk.is_file() and junk.suffix not in (".h", ".def", ".inc", ".gen", ".td", ".modulemap"):
        junk.unlink()
shutil.copytree(build / "lib/clang/24", pkg / "lib/clang/24", dirs_exist_ok=True)

commands = json.loads((build / "compile_commands.json").read_text())
for entry in commands:
    if entry["file"].endswith("/clang/tools/driver/clang-driver.cpp") or entry["file"].endswith("tools/clang/tools/driver/clang-driver.cpp"):
        break
else:
    sys.exit("stage: clang-driver.cpp is not in compile_commands.json")
args = shlex.split(entry["command"])
out = []
i = 1
keep_inc = {str(build / "include"): "include", str(src / "llvm/include"): "include"}
while i < len(args):
    a = args[i]
    if a in ("-o", "-c", "-MF", "-MT", "-MQ"):
        i += 2
        continue
    if a in ("-MD", "-MMD"):
        i += 1
        continue
    if a == "-Xclang" and i + 3 < len(args) and args[i + 1] in ("-include-pch", "-include"):
        i += 4
        continue
    if a.startswith("-I"):
        path = a[2:] or args[i + 1]
        step = 1 if a[2:] else 2
        mapped = keep_inc.get(os.path.normpath(path))
        if mapped and f"-I{mapped}" not in out:
            out.append(f"-I{mapped}")
        i += step
        continue
    if a.startswith("-ffile-prefix-map="):
        i += 1
        continue
    if a.endswith(".cpp"):
        i += 1
        continue
    out.append(a)
    i += 1
if "-Iinclude" not in out:
    sys.exit(f"stage: no package include dir in clang-driver.cpp's command: {args}")
manifest["multicall"] = {
    "compiler": "em++",
    "args": out,
    "note": "clang-driver.cpp's compile command without -o/-c/the source, PCH and dependency flags; -I paths are package-relative",
}
(pkg / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
n_obj = sum(len(t["objects"]) for t in manifest["tools"].values())
print(f"stage: {len(libs_seen)} libraries, {n_obj} objects, {len(manifest['tools'])} tools")
