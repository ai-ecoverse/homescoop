#!/usr/bin/env bash
# Relink the prebuilt cmake.wasm objects from slicc-emscripten for the wasm
# realm (ENVIRONMENT=web,worker,node + libslicc spawn profile). Recompiles
# musl sigaction/sigset_t layout objects (pre-Oct-2026 .o vs today's cache),
# applies the CMAKE_ROOT env patch, and recompiles cmSystemTools.cxx.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/cmake"
VERSION="4.4.3"
PKG_VER="4.4.3-9"
WORK="${HOMESCOOP_WORK:-${TMPDIR:-/tmp}/homescoop-work}"
export HOMESCOOP_PKG VERSION WORK
mkdir -p "$WORK"

SLICC_EM="${SLICC_EMSCRIPTEN:-$ROOT/../slicc-emscripten}"
BUILD="$SLICC_EM/build/cmake-wasm-build"
SRC_CMAKE="$SLICC_EM/src/cmake-4.4.3"
PKG="$HOMESCOOP_PKG/package"
ROOT_ENV_PATCH="$SLICC_EM/patches/cmake-4.4.3-cmake-root-env.patch"
PRERUN="$HOMESCOOP_PKG/cmake-env-prerun.js"

# Prefer the emscripten that produced the .o/.a tree (ABI match).
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

for need in \
  "$BUILD/Source/CMakeFiles/cmake.dir/cmakemain.cxx.o" \
  "$BUILD/Source/CMakeFiles/cmake.dir/cmcmd.cxx.o" \
  "$BUILD/Source/libCMakeLib.a" \
  "$BUILD/Utilities/cmlibuv/libcmlibuv.a" \
  "$ROOT_ENV_PATCH" \
  "$PRERUN"
do
  test -f "$need" || {
    echo "homescoop: missing $need" >&2
    exit 1
  }
done
test -d "$SRC_CMAKE/Modules" || {
  echo "homescoop: missing $SRC_CMAKE/Modules" >&2
  exit 1
}

export EMAR="$EMAR"
echo "== cmake: recompile sigaction/sigset_t layout objects (fail if a new one appears)"
python3 "$ROOT/scripts/slicc-sig-layout-guard.py" \
  --ninja "$BUILD/build.ninja" \
  --allowlist "$HOMESCOOP_PKG/sig-layout-sources.txt" \
  --src-root "$SRC_CMAKE" \
  --archive Source/kwsys/libcmsys.a \
  --archive Source/libCMakeLib.a \
  --archive Utilities/cmlibuv/libcmlibuv.a \
  --archive Utilities/cmcurl/lib/libcmcurl.a \
  --archive Utilities/cmliblzma/libcmliblzma.a \
  --object Source/CMakeFiles/cmake.dir/cmakemain.cxx.o \
  --object Source/CMakeFiles/cmake.dir/cmcmd.cxx.o \
  --recompile

# Ensure CMAKE_ROOT env patch is applied to the cmake source tree.
if git -C "$SRC_CMAKE" apply --reverse --check "$ROOT_ENV_PATCH" >/dev/null 2>&1; then
  echo "== cmake: CMAKE_ROOT env patch already applied"
else
  echo "== cmake: apply CMAKE_ROOT env patch"
  git -C "$SRC_CMAKE" apply "$ROOT_ENV_PATCH"
fi

# Recompile cmSystemTools.cxx into libCMakeLib.a (only object touched by the patch).
STOOL_O="$BUILD/Source/CMakeFiles/CMakeLib.dir/cmSystemTools.cxx.o"
echo "== cmake: recompile cmSystemTools.cxx.o"
"$EMXX" -DCURL_STATICLIB -DLIBARCHIVE_STATIC \
  -I"$BUILD/Utilities" -I"$BUILD/Source" \
  -I"$SRC_CMAKE/Source" -I"$SRC_CMAKE/Source/LexerParser" \
  -isystem "$SRC_CMAKE/Utilities/std" -isystem "$SRC_CMAKE/Utilities" \
  -fexceptions -O3 -DNDEBUG -std=c++17 \
  -c "$SRC_CMAKE/Source/cmSystemTools.cxx" -o "$STOOL_O"
"$EMAR" r "$BUILD/Source/libCMakeLib.a" "$STOOL_O"
echo "== cmake: updated libCMakeLib.a with CMAKE_ROOT env support"

# Realm slicc shims: spawn/exec + gaps/signals + select/poll (libuv waitpid/SIGCHLD).
# No slicc_main_envp — cmake already has main (gmake needs main_envp only because
# of -Dmain=slicc_tool_main). slicc_select provides slicc_poll_js so libuv's poll
# enters the realm kernel and pending SIGCHLD is delivered.
SLICC_A="$WORK/libslicc-cmake.a"
ODIR="$WORK/slicc-objs-cmake-em"
rm -rf "$ODIR"
mkdir -p "$ODIR"
objs=()
for src in slicc_spawn slicc_exec slicc_libc_gaps slicc_signals slicc_select; do
  echo "== slicc shim: $EMCC -c ${src}.c"
  "$EMCC" -O2 -c "$ROOT/shims/slicc/${src}.c" -o "$ODIR/${src}.o"
  objs+=("$ODIR/${src}.o")
done
rm -f "$SLICC_A"
"$EMAR" rcs "$SLICC_A" "${objs[@]}"
echo "== slicc shim: $SLICC_A (spawn+select)"

RELINK_OUT="$WORK/cmake-relink"
mkdir -p "$RELINK_OUT"
echo "== cmake: relink for web,worker,node → $RELINK_OUT/cmake"

export HOMESCOOP_EM_CLI_LDFLAGS_EXTRA="-sSTACK_SIZE=4194304 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0 -sEXPORTED_RUNTIME_METHODS=FS,callMain -sDISABLE_EXCEPTION_CATCHING=0 -lnodefs.js --pre-js ${PRERUN}"
# Emit .js (no shebang); slicc.commands expects bare bin/cmake.
# shellcheck disable=SC2046,SC2086
"$EMXX" -O3 -std=c++17 -fexceptions \
  "$BUILD/Source/CMakeFiles/cmake.dir/cmakemain.cxx.o" \
  "$BUILD/Source/CMakeFiles/cmake.dir/cmcmd.cxx.o" \
  "$BUILD/Source/libCMakeLib.a" \
  "$BUILD/Utilities/std/libcmstd.a" \
  "$BUILD/Source/kwsys/libcmsys.a" \
  "$BUILD/Utilities/cmcurl/lib/libcmcurl.a" \
  "$BUILD/Utilities/cmnghttp2/libcmnghttp2.a" \
  "$BUILD/Utilities/cmexpat/libcmexpat.a" \
  "$BUILD/Utilities/cmjsoncpp/libcmjsoncpp.a" \
  "$BUILD/Utilities/cmlibarchive/libarchive/libcmlibarchive.a" \
  "$BUILD/Utilities/cmbzip2/libcmbzip2.a" \
  "$BUILD/Utilities/cmliblzma/libcmliblzma.a" \
  "$BUILD/Utilities/cmzstd/libcmzstd.a" \
  "$BUILD/Utilities/cmlibrhash/libcmlibrhash.a" \
  "$BUILD/Utilities/cmlibuv/libcmlibuv.a" \
  "$BUILD/Utilities/cmzlib/libcmzlib.a" \
  "$BUILD/Utilities/cmllpkgc/libcmllpkgc.a" \
  $(homescoop_slicc_link_archive "$SLICC_A") \
  $(homescoop_em_cli_ldflags) \
  -o "$RELINK_OUT/cmake.js"

test -f "$RELINK_OUT/cmake.js" && test -f "$RELINK_OUT/cmake.wasm"
cp "$RELINK_OUT/cmake.js" "$RELINK_OUT/cmake"

echo "== cmake: QC glue (realm-safe ENVIRONMENT + slicc_poll_js)"
RELINK_GLUE="$RELINK_OUT/cmake" python3 - <<'PY'
from pathlib import Path
import os
p = Path(os.environ["RELINK_GLUE"])
t = p.read_text()
assert not t.startswith("#!"), "shebang present — realm loader cannot eval"
assert "ENVIRONMENT_IS_WORKER" in t and "ENVIRONMENT_IS_WEB" in t
assert "CMAKE_ROOT" in t, "pre-js CMAKE_ROOT bridge missing from glue"
poll = t.count("slicc_poll_js")
sel = t.count("slicc_select_js")
print(f"  require( occurrences: {t.count('require(')}")
print(f"  NODEFS refs: {t.count('NODEFS')}")
print(f"  slicc_poll_js: {poll}  slicc_select_js: {sel}")
assert t.count("NODEFS") > 0, "missing -lnodefs.js"
assert poll > 0, "PRESTAGE fail — slicc_poll_js missing (need slicc_select.o)"
print("  QC OK")
PY

echo "== cmake: stage binary + modules"
mkdir -p "$PKG/bin" "$PKG/share/cmake-4.4"
cp "$RELINK_OUT/cmake" "$PKG/bin/cmake"
cp "$RELINK_OUT/cmake.wasm" "$PKG/bin/cmake.wasm"
chmod +x "$PKG/bin/cmake"
cp "$RELINK_OUT/cmake" "$BUILD/bin/cmake"
cp "$RELINK_OUT/cmake.wasm" "$BUILD/bin/cmake.wasm"
chmod +x "$BUILD/bin/cmake"
rm -f "$BUILD/bin/cmake.js"

rsync -a --delete "$SRC_CMAKE/Modules/" "$PKG/share/cmake-4.4/Modules/"
rsync -a --delete "$SRC_CMAKE/Templates/" "$PKG/share/cmake-4.4/Templates/"

# SLICC: uname is Emscripten but WASI programs run natively — host=WASI.
DET="$PKG/share/cmake-4.4/Modules/CMakeDetermineSystem.cmake"
if ! grep -q 'SLICC/homescoop: cmake.wasm' "$DET"; then
  echo "== cmake: patch CMakeDetermineSystem.cmake (Emscripten host → WASI)"
  python3 - "$DET" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
t = p.read_text()
needle = "# find out on which system cmake runs\nif(CMAKE_HOST_UNIX)"
patch = """# SLICC/homescoop: cmake.wasm's uname reports Emscripten, but WASI programs run
# natively in the realm (try_run works). Map that host to WASI so
# Platform/WASI.cmake applies and executables are bare modules (not .js).
# Explicit -DCMAKE_SYSTEM_NAME=Emscripten still wins below when set by the user.
if(CMAKE_HOST_SYSTEM_NAME STREQUAL "Emscripten")
  set(CMAKE_HOST_SYSTEM_NAME "WASI")
  set(CMAKE_HOST_SYSTEM_PROCESSOR "wasm32")
endif()

# find out on which system cmake runs
if(CMAKE_HOST_UNIX)"""
if needle not in t:
    raise SystemExit("homescoop: CMakeDetermineSystem.cmake anchor not found")
p.write_text(t.replace(needle, patch, 1))
print("  patched", p)
PY
fi

if [[ -f "$SRC_CMAKE/Copyright.txt" ]]; then
  cp "$SRC_CMAKE/Copyright.txt" "$PKG/LICENSE"
elif [[ -f "$SRC_CMAKE/LICENSE.rst" ]]; then
  cp "$SRC_CMAKE/LICENSE.rst" "$PKG/LICENSE"
fi

node -e '
const fs = require("fs");
const p = process.argv[1];
const ver = process.argv[2];
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.version = ver;
j.description = "CMake 4.4.3 for wasm / slicc (WASI host + slicc_poll for libuv)";
j.files = ["README.md", "LICENSE", "bin", "share"];
j.slicc = j.slicc || { abi: "emscripten", commands: {} };
j.slicc.env = { CMAKE_ROOT: "${package}/share/cmake-4.4" };
j.slicc.commands = {
  cmake: {
    glue: "bin/cmake",
    wasm: "bin/cmake.wasm",
    env: { CMAKE_ROOT: "${package}/share/cmake-4.4" },
  },
};
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
' "$PKG/package.json" "$PKG_VER"

cat > "$PKG/README.md" <<'EOF'
# `@ai-ecoverse/wasm-cmake`

CMake 4.4.3 for slicc's wasm realm (relinked with `homescoop_em_cli_ldflags`
+ libslicc spawn profile). Honors `CMAKE_ROOT` (manifest default:
`${package}/share/cmake-4.4`) so modules resolve when argv0 is `/usr/bin/cmake`.

```bash
pnpm add -g @ai-ecoverse/wasm-cmake
cmake -E echo hello
cmake -P script.cmake
```
EOF

du -sh "$PKG" "$PKG/bin" "$PKG/share"
echo "== cmake: staged → $PKG ($PKG_VER)"

echo "== cmake: PRESTAGE smoke (not --version)"
node "$ROOT/scripts/smoke-cmake.mjs"
