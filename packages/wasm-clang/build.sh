#!/usr/bin/env bash
# Relink llvm-wasm tools against current libslicc (sliccKernel spawn) and stage
# @ai-ecoverse/wasm-clang. No LLVM source rebuild — reuse existing .o/.a from
# slicc-emscripten/build/llvm-wasm.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/wasm-clang"
VERSION="24.0.0"
PKG_VER="24.0.0-9"
PKG="$HOMESCOOP_PKG/package"
WORK="${HOMESCOOP_WORK:-${TMPDIR:-/tmp}/homescoop-work}/wasm-clang-relink"
mkdir -p "$WORK"
SLICC_EM="${SLICC_EMSCRIPTEN:-$ROOT/../slicc-emscripten}"
LLVM="${LLVM_WASM:-$SLICC_EM/build/llvm-wasm}"
NINJA="$LLVM/build.ninja"
POST_JS="$SLICC_EM/slicc-node-main.js"

if [[ -x "$SLICC_EM/src/emscripten/em++" ]]; then
  export EM_CONFIG="${SLICC_EM}/emscripten-config"
  export EM_CACHE="${SLICC_EM}/cache"
  export EMSDK_PYTHON="${EMSDK_PYTHON:-/opt/homebrew/bin/python3.13}"
  EMXX="$SLICC_EM/src/emscripten/em++"
  EMCC="$SLICC_EM/src/emscripten/emcc"
  EMAR="$SLICC_EM/src/emscripten/emar"
else
  EMXX="$(command -v em++)"
  EMCC="$(command -v emcc)"
  EMAR="$(command -v emar)"
fi

for need in "$NINJA" "$POST_JS" "$LLVM/lib/clang/24" \
  "$LLVM/tools/clang/tools/driver/CMakeFiles/clang.dir/driver.cpp.o"
do
  test -e "$need" || { echo "homescoop: missing $need" >&2; exit 1; }
done

echo "== wasm-clang: libslicc spawn archive (current sliccKernel)"
SLICC_A="$WORK/libslicc-clang.a"
# Compile with the same emcc that will link (ABI match).
ODIR="$WORK/slicc-objs"
rm -rf "$ODIR"
mkdir -p "$ODIR"
objs=()
for src in slicc_spawn slicc_exec slicc_libc_gaps slicc_signals; do
  echo "== slicc shim: $EMCC -c ${src}.c"
  "$EMCC" -O2 -c "$ROOT/shims/slicc/${src}.c" -o "$ODIR/${src}.o"
  objs+=("$ODIR/${src}.o")
done
KEEP_O="$ODIR/keep-slicc-spawn.o"
echo "== slicc shim: $EMCC -c keep-slicc-spawn.c"
"$EMCC" -O2 -c "$HOMESCOOP_PKG/keep-slicc-spawn.c" -o "$KEEP_O"
objs+=("$KEEP_O")
rm -f "$SLICC_A"
"$EMAR" rcs "$SLICC_A" "${objs[@]}"
# Confirm the object embeds sliccKernel (EM_JS string).
strings "$ODIR/slicc_spawn.o" | grep -q sliccKernel || {
  echo "homescoop: slicc_spawn.o missing sliccKernel string" >&2
  exit 1
}

# Relink one tool: parse ninja edge, drop old slicc_spawn.o, add libslicc + CLI ldflags.
relink_tool() {
  local ninja_target=$1 # e.g. bin/clang.js-24
  local out_name=$2     # e.g. clang
  local out_dir="$WORK/relink"
  mkdir -p "$out_dir"
  echo "== relink $ninja_target → $out_dir/$out_name"
  if [[ -f "$out_dir/$out_name" && -f "$out_dir/$out_name.wasm" ]]; then
    local existing
    existing=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().count("sliccKernel"))' "$out_dir/$out_name")
    if [[ "$existing" -gt 0 ]]; then
      echo "  skip (already has $existing sliccKernel refs)"
      return 0
    fi
    echo "  re-link (prior glue had 0 sliccKernel)"
  fi

  python3 - "$NINJA" "$ninja_target" "$LLVM" "$out_dir/$out_name" "$SLICC_A" "$EMXX" "$POST_JS" <<'PY'
import shlex, subprocess, sys
from pathlib import Path

ninja, target, llvm, out, slicc_a, emxx, post_js = sys.argv[1:8]
llvm = Path(llvm)
lines = Path(ninja).read_text().splitlines()
build = flags = link_flags = link_libs = None
for i, line in enumerate(lines):
    if line.startswith(f"build {target}:"):
        build = line
        for j in range(i + 1, min(i + 40, len(lines))):
            L = lines[j]
            if L.startswith("build ") or L.startswith("rule ") or L.startswith("#"):
                break
            if L.startswith("  FLAGS ="):
                flags = L.split("=", 1)[1].strip()
            elif L.startswith("  LINK_FLAGS ="):
                link_flags = L.split("=", 1)[1].strip()
            elif L.startswith("  LINK_LIBRARIES ="):
                link_libs = L.split("=", 1)[1].strip()
        break
if not build or link_flags is None or link_libs is None:
    sys.exit(f"homescoop: ninja edge not found for {target}")

# Objects between rule name and first |
rest = build.split(":", 1)[1].strip()
before_order = rest.split("|")[0].strip().split()
rule = before_order[0]
objs = [x for x in before_order[1:] if x.endswith(".o")]
if not objs:
    sys.exit(f"homescoop: no objects for {target}")

# Drop old slicc_spawn.o / slicc-node-main from LINK_FLAGS; keep the rest.
lf = []
skip_next_extern = False
parts = shlex.split(link_flags)
i = 0
while i < len(parts):
    p = parts[i]
    if p.endswith("slicc_spawn.o"):
        i += 1
        continue
    if p.startswith("--extern-post-js"):
        # drop old post-js path; we re-add below
        if p == "--extern-post-js" or p.startswith("--extern-post-js="):
            if "=" not in p:
                i += 2
            else:
                i += 1
            continue
    # Drop ENVIRONMENT / ALLOW_MEMORY_GROWTH / etc. that homescoop_em_cli will set;
    # keep LLVM-specific ones we'll re-add explicitly.
    if p.startswith("-sENVIRONMENT=") or p.startswith("-sEXIT_RUNTIME="):
        i += 1
        continue
    # --gc-sections drops unused slicc_spawn EM_JS (llvm-ar never calls spawn).
    if p in ("-Wl,--gc-sections", "--gc-sections"):
        i += 1
        continue
    lf.append(p)
    i += 1

# Absolute paths for objs and libs
abs_objs = [str(llvm / o) for o in objs]
libs = []
for lib in shlex.split(link_libs):
    if lib.startswith("-l"):
        libs.append(lib)
    else:
        libs.append(str(llvm / lib) if not lib.startswith("/") else lib)

# Realm link profile (same family as wasm-cmake / wasm-gmake).
extra = [
    "-sDISABLE_EXCEPTION_CATCHING=0",
    "-sALLOW_MEMORY_GROWTH=1",
    "-sSTACK_SIZE=8388608",
    "-sFORCE_FILESYSTEM=1",
    "-sINVOKE_RUN=0",
    "-sEXPORTED_RUNTIME_METHODS=FS,callMain",
    "-sENVIRONMENT=web,worker,node",
    "-sEXIT_RUNTIME=1",
    f"--extern-post-js={post_js}",
    # force spawn/exec out of libslicc (whole-archive)
    "-Wl,-u,slicc_raise",
    "-Wl,-u,slicc_sig_mask",
    "-Wl,-u,slicc_sigpipe",
    "-Wl,-u,__syscall_wait4",
    "-Wl,-u,execve",
    "-Wl,-u,slicc_spawn_capture",
    "-Wl,-u,homescoop_keep_slicc_spawn",
    "-Wl,--whole-archive",
    slicc_a,
    "-Wl,--no-whole-archive",
    # Keepalive export so metadce cannot drop spawn EM_JS on tools that never spawn.
    "-sEXPORTED_FUNCTIONS=_main,_homescoop_keep_slicc_spawn",
]

cmd = [emxx, "-O3", "-fexceptions", *abs_objs, *libs, *lf, *extra, "-o", f"{out}.js"]
print("  link:", " ".join(shlex.quote(c) for c in cmd[:6]), f"... ({len(cmd)} args)")
r = subprocess.run(cmd)
sys.exit(r.returncode)
PY

  test -f "$out_dir/$out_name.js" && test -f "$out_dir/$out_name.wasm"
  # Prefer bare glue name for slicc.commands
  mv "$out_dir/$out_name.js" "$out_dir/$out_name"
  local n
  # Glue is often one long line — count occurrences, not grep -c lines.
  n=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().count("sliccKernel"))' "$out_dir/$out_name")
  echo "  sliccKernel refs: $n"
  if [[ "$n" -lt 1 ]]; then
    echo "homescoop: PRESTAGE fail — $out_name glue has 0 sliccKernel" >&2
    exit 1
  fi
}

# Relink the tools that ship in the package (clang is the slow/large one).
relink_tool bin/clang.js-24 clang
relink_tool bin/lld.js lld
relink_tool bin/llvm-ar.js llvm-ar
relink_tool bin/llvm-nm.js llvm-nm
relink_tool bin/llvm-objcopy.js llvm-objcopy
relink_tool bin/llvm-symbolizer.js llvm-symbolizer

# wasm-opt lives in @ai-ecoverse/wasm-binaryen (driver finds it on PATH).
echo "== wasm-clang: stage package $PKG_VER (no bundled wasm-opt)"
rm -rf "$PKG/bin" "$PKG/lib"
mkdir -p "$PKG/bin" "$PKG/lib/clang"

stage_pair() {
  local name=$1
  cp "$WORK/relink/$name" "$PKG/bin/$name"
  cp "$WORK/relink/$name.wasm" "$PKG/bin/$name.wasm"
  chmod +x "$PKG/bin/$name" "$PKG/bin/$name.wasm"
}
stage_pair clang
stage_pair lld
stage_pair llvm-ar
stage_pair llvm-nm
stage_pair llvm-objcopy
stage_pair llvm-symbolizer
rm -f "$PKG/bin/wasm-opt" "$PKG/bin/wasm-opt.wasm"

# emcc builds absolute paths under LLVM_ROOT (…/bin/clang++, …/bin/wasm-ld, …).
# slicc.commands argv0 aliases alone are not enough — ship a glue *file* per
# alias name (byte-copy of the primary glue, no .wasm). The glue hardcodes
# locateFile("clang.wasm") / "lld.wasm" / … so the sibling module is found;
# argv0 becomes the alias filename (same pattern as wasm-git libexec copies).
stage_glue_alias() {
  local src=$1 dest=$2
  cp "$PKG/bin/$src" "$PKG/bin/$dest"
  chmod +x "$PKG/bin/$dest"
  [[ ! -e "$PKG/bin/$dest.wasm" ]]
}
stage_glue_alias clang clang++
stage_glue_alias lld wasm-ld
stage_glue_alias lld ld.lld
stage_glue_alias llvm-ar llvm-ranlib
stage_glue_alias llvm-objcopy llvm-strip

rsync -a --delete "$LLVM/lib/clang/24/" "$PKG/lib/clang/24/"

# clang 24 --target=wasm32-wasip1 looks for builtins at
# $resource-dir/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a (not the
# sysroot's libclang_rt.builtins-wasm32.a name).
SYSROOT_PKG="$ROOT/packages/wasix-sysroot/package"
BUILTINS_SRC="$SYSROOT_PKG/sysroot-exnref-eh/lib/wasm32-wasip1/libclang_rt.builtins-wasm32.a"
test -f "$BUILTINS_SRC" || {
  # Fallback while migrating from pre-wasip1-real packages.
  BUILTINS_SRC="$SYSROOT_PKG/sysroot-exnref-eh/lib/wasm32-wasi/libclang_rt.builtins-wasm32.a"
}
test -f "$BUILTINS_SRC" || {
  echo "homescoop: missing builtins under wasip1/wasi (build wasix-sysroot first)" >&2
  exit 1
}
for triple in wasm32-unknown-wasip1 wasm32-unknown-wasi; do
  mkdir -p "$PKG/lib/clang/24/lib/$triple"
  # Real file copy (not a symlink) — npm/ipk skip links.
  cp "$BUILTINS_SRC" "$PKG/lib/clang/24/lib/$triple/libclang_rt.builtins.a"
  [[ ! -L "$PKG/lib/clang/24/lib/$triple/libclang_rt.builtins.a" ]]
done
echo "== wasm-clang: installed resource-dir builtins for wasip1/wasi (real dirs)"

DRIVER="$HOMESCOOP_PKG/drivers/wasix-driver.sh"
test -f "$DRIVER"
for name in cc gcc c++ g++ wasixcc wasix++; do
  cp "$DRIVER" "$PKG/bin/$name"
  chmod +x "$PKG/bin/$name"
done

cp "$SLICC_EM/src/llvm-project/LICENSE.TXT" "$PKG/LICENSE"

cat > "$PKG/README.md" <<'EOF'
# @ai-ecoverse/wasm-clang

Clang/LLD 24 for the slicc wasm realm. Relinked with current libslicc
(`Module.sliccKernel` spawn) + `ENVIRONMENT=web,worker,node`.

Companions:

- `@ai-ecoverse/wasix-sysroot` (`WASIXCC_SYSROOT_PREFIX`)
- `@ai-ecoverse/wasm-binaryen` (`wasm-opt` for fork Asyncify — on `PATH`)

## Drivers

`cc` / `gcc` / `c++` / `g++` / `wasixcc` / `wasix++` are `#!/bin/sh` scripts
(`slicc.commands` `{ "script": "bin/…" }`). Use them as the normal compilers —
no extra WASI/EH flags needed for typical builds.

- Target: `--target=wasm32-wasip1` (sysroot ships a real `lib/wasm32-wasip1`).
- C++ links `-lc++ -lc++abi -lunwind` (exnref exceptions, threads, iostream).
- Output is a **WASI program** SLICC runs directly (no separate host wrapper).
- Executable link that imports `proc_fork` / `stack_checkpoint` runs
  `wasm-opt --asyncify` (from `@ai-ecoverse/wasm-binaryen`) automatically so
  **fork works** on the SLICC host. Plain programs skip asyncify.
- **`-shared`**: side module, `-nostdlib` (no libc) — resolve symbols against
  a PIE main that exports them.
- **PIE / dlopen main**: `cc -rdynamic …` or `cc -fPIC foo.c -o foo` (no
  `-shared`) → `-pie --export-all`, libc whole-archive, tag stubs. Then
  `dlopen("./libsq.so")` works.
- **CMake**: `CC=cc CXX=c++ cmake …` — Clang 24 is identified; `pthread.h`
  and the sysroot resolve under SLICC.

## LLVM tool aliases (emcc path spawn)

`bin/` ships glue **file copies** for names emcc constructs under `LLVM_ROOT`:
`clang++`, `wasm-ld`, `ld.lld`, `llvm-ranlib`, `llvm-strip`. Each is a
byte-copy of the primary glue (`clang` / `lld` / `llvm-ar` / `llvm-objcopy`);
the `.wasm` stays next to the primary name only (`locateFile("clang.wasm")`
etc.). `slicc.commands` argv0 aliases still work for PATH lookups.

**Not shipped** (emcc only needs these for `-g` / split-dwarf / coverage /
`emsize` / sourcemap demangle): `llvm-dwarfdump`, `llvm-dwp`,
`clang-scan-deps`, `llvm-profdata`, `llvm-cov`, `llvm-size`, `llvm-cxxfilt`.

```bash
cc hello.c -o hello
cc -fPIC -shared sq.c -o libsq.so
cc -rdynamic -fPIC dl.c -o dl   # PIE main exporting libc for dlopen
c++ -O2 t.cpp -o t              # iostream + exceptions + threads

CC=cc CXX=c++ cmake -S . -B build
cmake --build build
```
EOF

# Keep package.json structure; bump version only.
node -e '
const fs = require("fs");
const p = process.argv[1];
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.version = process.argv[2];
j.description = "Clang/LLD 24 for slicc (clang24 EH; asyncify via wasm-binaryen)";
if (j.bin) delete j.bin;
j.dependencies = j.dependencies || {};
j.dependencies["@ai-ecoverse/wasix-sysroot"] = "^2025.9.30-10";
j.dependencies["@ai-ecoverse/wasm-binaryen"] = "132.0.0-1";
j.slicc = j.slicc || { abi: "emscripten", env: {}, commands: {} };
j.slicc.env = {
  CLANG_RESOURCE_DIR: "${package}/lib/clang/24",
  WASIXCC_SYSROOT_PREFIX: "/shared/lib/node_modules/@ai-ecoverse/wasix-sysroot",
};
const cmds = j.slicc.commands || {};
for (const name of ["cc", "gcc", "c++", "g++", "wasixcc", "wasix++"]) {
  cmds[name] = { script: "bin/" + name };
}
const glue = (n, argv0) => ({ glue: "bin/" + n, wasm: "bin/" + n + ".wasm", argv0: argv0 || n });
cmds.clang = glue("clang", "clang");
cmds["clang++"] = glue("clang", "clang++");
cmds.lld = glue("lld", "lld");
cmds["wasm-ld"] = glue("lld", "wasm-ld");
cmds["ld.lld"] = glue("lld", "ld.lld");
cmds["llvm-ar"] = glue("llvm-ar", "llvm-ar");
cmds.ar = glue("llvm-ar", "llvm-ar");
cmds.ranlib = glue("llvm-ar", "llvm-ranlib");
cmds["llvm-ranlib"] = glue("llvm-ar", "llvm-ranlib");
cmds["llvm-nm"] = glue("llvm-nm", "llvm-nm");
cmds.nm = glue("llvm-nm", "llvm-nm");
cmds["llvm-objcopy"] = glue("llvm-objcopy", "llvm-objcopy");
cmds["llvm-strip"] = glue("llvm-objcopy", "llvm-strip");
cmds.strip = glue("llvm-objcopy", "llvm-strip");
cmds["llvm-symbolizer"] = glue("llvm-symbolizer", "llvm-symbolizer");
delete cmds["wasm-opt"];
j.slicc.commands = cmds;
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
' "$PKG/package.json" "$PKG_VER"

echo "== PRESTAGE: sliccKernel counts + alias glues + no package links + no bundled wasm-opt"
for g in clang lld llvm-ar llvm-nm llvm-objcopy llvm-symbolizer; do
  n=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().count("sliccKernel"))' "$PKG/bin/$g")
  printf "  bin/%s: %s\n" "$g" "$n"
  [[ "$n" -gt 0 ]] || { echo "fail $g" >&2; exit 1; }
done
# Alias glues: same bytes as primary, no sibling .wasm, and cover emcc paths.
for pair in "clang:clang++" "lld:wasm-ld" "lld:ld.lld" "llvm-ar:llvm-ranlib" "llvm-objcopy:llvm-strip"; do
  src=${pair%%:*}; dest=${pair##*:}
  test -f "$PKG/bin/$dest"
  [[ ! -e "$PKG/bin/$dest.wasm" ]]
  cmp -s "$PKG/bin/$src" "$PKG/bin/$dest" || {
    echo "homescoop: alias glue bin/$dest must be a byte-copy of bin/$src" >&2
    exit 1
  }
  printf "  alias bin/%s -> bin/%s (no .wasm)\n" "$dest" "$src"
done
# Paths emcc 6 shared.py / emstrip construct under LLVM_ROOT that we ship:
for need in clang clang++ llvm-ar llvm-ranlib llvm-nm llvm-objcopy llvm-strip wasm-ld llvm-symbolizer; do
  test -f "$PKG/bin/$need" || {
    echo "homescoop: missing LLVM_ROOT tool bin/$need for emcc path spawn" >&2
    exit 1
  }
done
[[ ! -e "$PKG/bin/wasm-opt" && ! -e "$PKG/bin/wasm-opt.wasm" ]] || {
  echo "homescoop: wasm-opt must not ship in wasm-clang (use wasm-binaryen)" >&2
  exit 1
}
[[ -d "$PKG/lib/clang/24/lib/wasm32-unknown-wasip1" && ! -L "$PKG/lib/clang/24/lib/wasm32-unknown-wasip1" ]]
[[ -f "$PKG/lib/clang/24/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a" \
   && ! -L "$PKG/lib/clang/24/lib/wasm32-unknown-wasip1/libclang_rt.builtins.a" ]]
homescoop_assert_no_package_links "$PKG"
PACK_DIR=$(mktemp -d)
TGZ=$(homescoop_npm_pack_no_links "$PKG" "$PACK_DIR")
cp "$TGZ" "$HOMESCOOP_PKG/ai-ecoverse-wasm-clang-${PKG_VER}.tgz"
rm -rf "$PACK_DIR"

cp "$HOMESCOOP_PKG/PRESTAGE.md" "$PKG/PRESTAGE.md" 2>/dev/null || true
du -sh "$PKG" "$PKG/bin/clang.wasm" "$PKG/bin/lld.wasm"
echo "OK wasm-clang $PKG_VER"
