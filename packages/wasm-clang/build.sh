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
PKG_VER="24.0.0-10"
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
  "$LLVM/tools/clang/tools/driver/CMakeFiles/clang.dir/driver.cpp.o" \
  "$LLVM/compile_commands.json" "$HOMESCOOP_PKG/multicall.cpp"
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

# One multi-call module for every tool (24.0.0-10): the tools' objects linked
# together, each tool's generated `<tool>-driver.cpp` main left out, and
# multicall.cpp's main choosing the tool by argv[0]. They share one LLVM.
TOOLS=(clang lld llvm-ar llvm-nm llvm-objcopy llvm-symbolizer)
# Every name the module answers to ships as a byte-copy of bin/llvm (emcc spawns
# paths under LLVM_ROOT; the glue locates llvm.wasm beside it).
ALIASES=(clang clang++ lld wasm-ld ld.lld llvm-ar llvm-ranlib llvm-nm \
  llvm-objcopy llvm-strip llvm-symbolizer)

# multicall.cpp initializes LLVM per tool as the generated driver mains do:
# clang with (true, true), the others with the defaults. Fail if that changed.
for t in "${TOOLS[@]}"; do
  drv=$(find "$LLVM/tools" -name "$t-driver.cpp" -print -quit)
  test -n "$drv" || { echo "homescoop: no generated $t-driver.cpp" >&2; exit 1; }
  init=$(grep -o 'InitLLVM X([^;]*' "$drv")
  if [[ $t == clang ]]; then
    want='InitLLVM X(argc, argv, /*InstallPipeSignalExitHandler=*/true, /*NeedsPOSIXUtilitySignalHandling=*/true)'
  else
    want='InitLLVM X(argc, argv)'
  fi
  [[ "$init" == "$want" ]] || {
    echo "homescoop: $t-driver.cpp has '$init'; multicall.cpp expects '$want'" >&2
    exit 1
  }
done

echo "== wasm-clang: compile multicall.cpp + the signal-ABI sources against the current sysroot"
# slicc-emscripten's musl sigset_t became 128 bytes (struct sigaction 140, was 20)
# after build/llvm-wasm was compiled: linked against today's libc, those objects'
# sigaction() calls overran their 20-byte slots and corrupted LLVM's globals
# (trap in llvm_shutdown, "Option 'debug-counter' registered more than once").
# These are every LLVM source that lays out sigset_t / struct sigaction /
# posix_spawnattr_t; recompiled here, they shadow libLLVMSupport.a's members.
ABI_SOURCES=(lib/Support/Signals.cpp lib/Support/Process.cpp lib/Support/Program.cpp
  lib/Support/CrashRecoveryContext.cpp)
MULTI_O="$ODIR/multicall.o"
EXTRA_OBJS=("$MULTI_O")
python3 - "$LLVM" "$HOMESCOOP_PKG/multicall.cpp" "$ODIR" "${ABI_SOURCES[@]}" <<'PY'
import json, shlex, subprocess, sys
from pathlib import Path
llvm, multicall, odir, *abi = sys.argv[1:]
entries = json.load(open(f"{llvm}/compile_commands.json"))
def compile(suffix, src, out):
    for entry in entries:
        if entry["file"].endswith(suffix):
            break
    else:
        sys.exit(f"homescoop: {suffix} not in compile_commands.json")
    args = shlex.split(entry["command"])
    # Without CMake's precompiled header: it was built against the old sysroot.
    i = 0
    while i < len(args):
        if args[i] == "-Xclang" and i + 3 < len(args) and args[i + 1] in ("-include-pch", "-include"):
            del args[i : i + 4]
        else:
            i += 1
    args[args.index("-o") + 1] = out
    args[args.index("-c") + 1] = src or entry["file"]
    print(f"  {Path(src or entry['file']).name} -> {out}")
    if subprocess.run(args, cwd=entry["directory"]).returncode:
        sys.exit(f"homescoop: compile failed: {suffix}")
compile("/clang-driver.cpp", multicall, f"{odir}/multicall.o")
for rel in abi:
    compile(f"/llvm/{rel}", None, f"{odir}/abi-{Path(rel).stem}.o")
PY
for rel in "${ABI_SOURCES[@]}"; do
  EXTRA_OBJS+=("$ODIR/abi-$(basename "${rel%.cpp}").o")
done
# The guard above holds only while these are all of them.
SLICC_LLVM_SRC="$SLICC_EM/src/llvm-project"
if [[ -d "$SLICC_LLVM_SRC/llvm/lib/Support" ]]; then
  users=$(cd "$SLICC_LLVM_SRC" && grep -rlE 'struct sigaction|sigset_t|sigprocmask|pthread_sigmask|sigemptyset|sigfillset|posix_spawnattr_setsig|sigaltstack' \
    llvm/lib clang/lib clang/tools/driver lld/ELF lld/wasm lld/Common lld/tools \
    llvm/tools/llvm-ar llvm/tools/llvm-nm llvm/tools/llvm-objcopy llvm/tools/llvm-symbolizer | sort | tr '\n' ' ')
  want="llvm/lib/Support/CrashRecoveryContext.cpp llvm/lib/Support/Unix/Process.inc llvm/lib/Support/Unix/Program.inc llvm/lib/Support/Unix/Signals.inc "
  [[ "$users" == "$want" ]] || {
    echo "homescoop: sources using signal structs changed: $users (recompile list covers: $want)" >&2
    exit 1
  }
fi

OUT_DIR="$WORK/relink-multi"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
ninja_targets="bin/clang.js-24"
for t in "${TOOLS[@]:1}"; do ninja_targets+=",bin/$t.js"; done
echo "== relink $ninja_targets → $OUT_DIR/llvm"
python3 - "$NINJA" "$ninja_targets" "$LLVM" "$OUT_DIR/llvm" "$SLICC_A" "$EMXX" "$POST_JS" "${EXTRA_OBJS[@]}" <<'PY'
import shlex, subprocess, sys
from pathlib import Path

ninja, targets, llvm, out, slicc_a, emxx, post_js, *extra_objs = sys.argv[1:]
llvm = Path(llvm)
lines = Path(ninja).read_text().splitlines()

def edge(target):
    """A ninja link edge: its objects (less the generated driver main), flags, libraries."""
    for i, line in enumerate(lines):
        if not line.startswith(f"build {target}:"):
            continue
        link_flags = link_libs = None
        for L in lines[i + 1 : i + 40]:
            if L.startswith(("build ", "rule ", "#")):
                break
            if L.startswith("  LINK_FLAGS ="):
                link_flags = L.split("=", 1)[1].strip()
            elif L.startswith("  LINK_LIBRARIES ="):
                link_libs = L.split("=", 1)[1].strip()
        if link_flags is None or link_libs is None:
            break
        rest = line.split(":", 1)[1].strip().split("|")[0].split()[1:]
        objs = [o for o in rest if o.endswith(".o")]
        drivers = [o for o in objs if o.endswith("-driver.cpp.o")]
        if len(drivers) != 1:
            sys.exit(f"homescoop: {target}: expected one generated driver main, got {drivers}")
        return [o for o in objs if o not in drivers], link_flags, link_libs
    sys.exit(f"homescoop: ninja edge not found for {target}")

objs, libs, flag_sets = [], [], []
for target in targets.split(","):
    o, link_flags, link_libs = edge(target)
    objs += [str(llvm / x) for x in o]
    for lib in shlex.split(link_libs):
        lib = lib if lib.startswith(("-", "/")) else str(llvm / lib)
        if lib not in libs:
            libs.append(lib)
    flag_sets.append(link_flags)
def realm_flags(link_flags):
    """LINK_FLAGS less the old slicc_spawn.o / post-js and what the realm profile sets below."""
    lf = []
    parts = shlex.split(link_flags)
    i = 0
    while i < len(parts):
        p = parts[i]
        if p == "--extern-post-js":
            i += 2
            continue
        i += 1
        if p.endswith("slicc_spawn.o") or p.startswith("--extern-post-js="):
            continue
        if p.startswith(("-sENVIRONMENT=", "-sEXIT_RUNTIME=")):
            continue
        # --gc-sections drops unused slicc_spawn EM_JS (llvm-ar never calls spawn).
        if p in ("-Wl,--gc-sections", "--gc-sections"):
            continue
        lf.append(p)
    return lf

lf = realm_flags(flag_sets[0])
for target, flags in zip(targets.split(","), flag_sets):
    if realm_flags(flags) != lf:
        # The tools were configured alike; a difference would need a decision.
        sys.exit(f"homescoop: {target}: LINK_FLAGS differ from clang's: {flags}")

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
    # Keepalive export so metadce cannot drop spawn EM_JS.
    "-sEXPORTED_FUNCTIONS=_main,_homescoop_keep_slicc_spawn",
]

# The recompiled objects come first: they shadow the stale archive members.
cmd = [emxx, "-O3", "-fexceptions", *extra_objs, *objs, *libs, *lf, *extra, "-o", f"{out}.js"]
print("  link:", " ".join(shlex.quote(c) for c in cmd[:4]), f"... ({len(cmd)} args)")
sys.exit(subprocess.run(cmd).returncode)
PY
test -f "$OUT_DIR/llvm.js" && test -f "$OUT_DIR/llvm.wasm"
mv "$OUT_DIR/llvm.js" "$OUT_DIR/llvm"
n=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().count("sliccKernel"))' "$OUT_DIR/llvm")
echo "  sliccKernel refs: $n"
[[ "$n" -gt 0 ]] || { echo "homescoop: PRESTAGE fail — llvm glue has 0 sliccKernel" >&2; exit 1; }
grep -q 'locateFile("llvm.wasm")' "$OUT_DIR/llvm" || {
  echo "homescoop: llvm glue does not locate llvm.wasm" >&2
  exit 1
}

# wasm-opt lives in @ai-ecoverse/wasm-binaryen (driver finds it on PATH).
echo "== wasm-clang: stage package $PKG_VER (no bundled wasm-opt)"
rm -rf "$PKG/bin" "$PKG/lib"
mkdir -p "$PKG/bin" "$PKG/lib/clang"
cp "$OUT_DIR/llvm" "$PKG/bin/llvm"
cp "$OUT_DIR/llvm.wasm" "$PKG/bin/llvm.wasm"
chmod +x "$PKG/bin/llvm" "$PKG/bin/llvm.wasm"
for name in "${ALIASES[@]}"; do
  cp "$PKG/bin/llvm" "$PKG/bin/$name"
  chmod +x "$PKG/bin/$name"
done

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

## One module for every tool

`bin/llvm.wasm` holds clang, lld, llvm-ar, llvm-nm, llvm-objcopy and
llvm-symbolizer, linked together so they share one copy of LLVM; the tool is
chosen by its name (argv[0]), or `llvm <tool> args…`. `bin/` ships a glue
**file** under every name emcc constructs under `LLVM_ROOT` (`clang`,
`clang++`, `lld`, `wasm-ld`, `ld.lld`, `llvm-ar`, `llvm-ranlib`, `llvm-nm`,
`llvm-objcopy`, `llvm-strip`, `llvm-symbolizer`): each is a byte-copy of
`bin/llvm`, which locates `llvm.wasm` beside it. `slicc.commands` covers the
same names plus `ar`, `ranlib`, `nm`, `strip` for PATH lookups.

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
// Every LLVM tool is the one multi-call module, chosen by argv0.
for (const n of Object.keys(cmds)) if (cmds[n].glue) delete cmds[n];
const tool = (argv0) => ({ glue: "bin/llvm", wasm: "bin/llvm.wasm", argv0 });
for (const n of ["clang", "clang++", "lld", "wasm-ld", "ld.lld", "llvm-ar", "llvm-ranlib",
  "llvm-nm", "llvm-objcopy", "llvm-strip", "llvm-symbolizer"]) {
  cmds[n] = tool(n);
}
cmds.ar = tool("llvm-ar");
cmds.ranlib = tool("llvm-ranlib");
cmds.nm = tool("llvm-nm");
cmds.strip = tool("llvm-strip");
delete cmds["wasm-opt"];
j.slicc.commands = cmds;
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
' "$PKG/package.json" "$PKG_VER"

echo "== PRESTAGE: one module, alias glues, dispatch, no package links, no bundled wasm-opt"
n=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().count("sliccKernel"))' "$PKG/bin/llvm")
printf "  bin/llvm: %s sliccKernel refs\n" "$n"
[[ "$n" -gt 0 ]] || { echo "fail llvm" >&2; exit 1; }
wasms=$(cd "$PKG/bin" && ls -- *.wasm)
[[ "$wasms" == "llvm.wasm" ]] || { echo "homescoop: bin/ must hold only llvm.wasm, got: $wasms" >&2; exit 1; }
# Alias glues: byte-copies of bin/llvm, and each name reaches its tool.
for name in "${ALIASES[@]}"; do
  cmp -s "$PKG/bin/llvm" "$PKG/bin/$name" || {
    echo "homescoop: alias glue bin/$name must be a byte-copy of bin/llvm" >&2
    exit 1
  }
  case $name in
    clang|clang++) want="clang version 24" ;;
    lld|wasm-ld|ld.lld) want="LLD 24" ;;
    llvm-ar|llvm-ranlib) want="LLVM version 24" ;;
    *) want="LLVM version 24" ;;
  esac
  if [[ $name == lld ]]; then got=$(node "$PKG/bin/$name" -flavor wasm --version 2>&1 || true)
  else got=$(node "$PKG/bin/$name" --version 2>&1 || true); fi
  grep -q "$want" <<<"$got" || {
    echo "homescoop: bin/$name --version: expected '$want', got: $got" >&2
    exit 1
  }
  printf "  bin/%s -> %s\n" "$name" "$want"
done
# Real work, not just --version (a corrupted link passed --version): clang with
# -mllvm (CommandLine registry) compiles, ar archives it, nm lists it.
SMOKE=$(mktemp -d)
printf 'int smoke_add(int a, int b) { return a + b; }\n' > "$SMOKE/s.c"
SLICC_PRELOAD="/w/s.c=$SMOKE/s.c" SLICC_EXPORT_DIR="/w=$SMOKE/out" \
  node "$PKG/bin/clang" --target=wasm32-wasip1 -O2 -mllvm -disable-lsr -c /w/s.c -o /w/s.o
SLICC_PRELOAD="/w/s.o=$SMOKE/out/s.o" SLICC_EXPORT_DIR="/w=$SMOKE/out2" \
  node "$PKG/bin/llvm-ar" rcs /w/libs.a /w/s.o
nm_out=$(SLICC_PRELOAD="/w/libs.a=$SMOKE/out2/libs.a" node "$PKG/bin/llvm-nm" /w/libs.a)
grep -q "T smoke_add" <<<"$nm_out" || {
  echo "homescoop: clang -c | llvm-ar | llvm-nm smoke failed: $nm_out" >&2
  exit 1
}
rm -rf "$SMOKE"
echo "  smoke: clang -mllvm -c, llvm-ar rcs, llvm-nm → T smoke_add"
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
du -sh "$PKG" "$PKG/bin/llvm.wasm"
echo "OK wasm-clang $PKG_VER"
