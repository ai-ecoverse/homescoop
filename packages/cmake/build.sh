#!/usr/bin/env bash
# @ai-ecoverse/wasm-cmake: CMake built in CI from the pinned release tarball
# (homescoop#859 stage G) with emcmake from the patched emscripten 6.0.9 tree
# on emsdk 6.0.9's prebuilt compilers (scripts/emscripten-tree.sh), linked
# against today's shims/slicc for the wasm realm (Module.sliccKernel spawn,
# slicc_poll for libuv's waitpid/SIGCHLD, kernel credentials).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe cmake
PKG="$HOMESCOOP_PKG/package"
PKG_VER="$(node -p 'require(process.argv[1]).version' "$PKG/package.json")"
SERIES="${VERSION%.*}"
TB="$WORK/cmake-$VERSION.tar.gz"
SRC="$WORK/cmake-$VERSION-src"
BLD="$WORK/cmake-$VERSION-build"
PRERUN="$HOMESCOOP_PKG/cmake-env-prerun.js"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$TB" -C "$SRC" --strip-components=1
homescoop_apply_patches "$SRC"
grep -q 'defined(__EMSCRIPTEN__) ||' "$SRC/Utilities/cmlibuv/include/uv/unix.h"
grep -q 'GetEnv("CMAKE_ROOT", root)' "$SRC/Source/cmSystemTools.cxx"
grep -q "slicc_spawn_capture(options->file" "$SRC/Utilities/cmlibuv/src/unix/process.c"
grep -q 'set(CMAKE_HOST_SYSTEM_NAME "WASI")' "$SRC/Modules/CMakeDetermineSystem.cmake"

eval "$(bash "$ROOT/scripts/emscripten-tree.sh" "$WORK/cmake-em")"
export EM_CONFIG="$EMSCRIPTEN_TREE_CONFIG"
EMCC=(python3 "$EMSCRIPTEN_TREE/emcc.py")
EMXX=(python3 "$EMSCRIPTEN_TREE/em++.py")
EMAR=(python3 "$EMSCRIPTEN_TREE/emar.py")
MAPS="-ffile-prefix-map=$SRC=/cmake -ffile-prefix-map=$BLD=/cmake/build"

echo "== cmake: libslicc (spawn, exec, signals, libc gaps with credentials, select/poll, sockets for file(DOWNLOAD))"
ODIR="$WORK/cmake-slicc-objs"
rm -rf "$ODIR"
mkdir -p "$ODIR"
objs=()
for src in slicc_spawn slicc_exec slicc_libc_gaps slicc_signals slicc_select slicc_socket; do
  "${EMCC[@]}" -O2 -c "$ROOT/shims/slicc/${src}.c" -o "$ODIR/${src}.o"
  objs+=("$ODIR/${src}.o")
done
SLICC_A="$ODIR/libslicc-cmake.a"
"${EMAR[@]}" rcs "$SLICC_A" "${objs[@]}"
grep -q sliccKernel "$ODIR/slicc_spawn.o"

echo "== cmake: emcmake (Release, no OpenSSL, no dialogs, no tests)"
rm -rf "$BLD"
python3 "$EMSCRIPTEN_TREE/emcmake.py" cmake -S "$SRC" -B "$BLD" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_TESTING=OFF \
  -DCMAKE_USE_OPENSSL=OFF \
  -DBUILD_CursesDialog=OFF \
  -DBUILD_QtDialog=OFF \
  "-DCMAKE_C_FLAGS=$MAPS" \
  "-DCMAKE_CXX_FLAGS=-fexceptions $MAPS" \
  "-DCMAKE_EXE_LINKER_FLAGS=-fexceptions -sDISABLE_EXCEPTION_CATCHING=0"
test -f "$BLD/Source/CMakeFiles/cmake.dir/link.txt"

OUT="$WORK/cmake-link"
rm -rf "$OUT"
mkdir -p "$OUT"
echo "== cmake: build, linking for web,worker,node → $OUT/cmake"
REALM=(
  -sENVIRONMENT=web,worker,node -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1
  -sSTACK_SIZE=4194304 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0
  -sEXPORTED_RUNTIME_METHODS=FS,callMain -sDISABLE_EXCEPTION_CATCHING=0
  -sDECLARE_ASM_MODULE_EXPORTS=0 -lnodefs.js --pre-js "$PRERUN"
  --js-library "$ROOT/shims/slicc/slicc-writev.js"
  --js-library "$ROOT/shims/slicc/slicc-linkat.js"
  --js-library "$ROOT/shims/slicc/slicc-uname.js"
  --js-library "$ROOT/shims/slicc/slicc-env.js"
  -Wl,-u,slicc_raise -Wl,-u,slicc_sig_mask -Wl,-u,slicc_sigpipe -Wl,-u,slicc_cred_euid -Wl,--wrap=raise
  -Wl,-u,__syscall_wait4 -Wl,-u,execve -Wl,-u,slicc_spawn_capture -Wl,-u,posix_spawn -Wl,-u,posix_spawnp
  -Wl,-u,popen -Wl,-u,pclose -Wl,-u,system
  -Wl,--whole-archive "$SLICC_A" -Wl,--no-whole-archive
)
python3 - "$BLD/Source/CMakeFiles/cmake.dir/link.txt" "$OUT/cmake.js" "${REALM[@]}" <<'PY'
import shlex, sys
link, out, *realm = sys.argv[1:]
args = shlex.split(open(link).read())
if not args[0].endswith("em++"):
    sys.exit(f"homescoop: cmake's link.txt does not start with em++: {args[0]}")
i = args.index("-o")
args[i + 1] = out
open(link, "w").write(" ".join(shlex.quote(a) for a in args + realm) + "\n")
print(f"  link.txt: cmake links to {out} with {len(realm)} realm flags")
PY
make -C "$BLD" -j"$JOBS" cmake
test -f "$OUT/cmake.js" && test -f "$OUT/cmake.wasm"
mv "$OUT/cmake.js" "$OUT/cmake"
python3 - "$OUT/cmake" <<'PY'
import re, sys
t = open(sys.argv[1], encoding="latin1").read()
assert not t.startswith("#!"), "shebang present: the realm loader cannot eval it"
assert "ENVIRONMENT_IS_WORKER" in t and "ENVIRONMENT_IS_WEB" in t
assert "CMAKE_ROOT" in t, "pre-js CMAKE_ROOT bridge missing from the glue"
assert t.count("NODEFS") > 0, "missing -lnodefs.js"
assert t.count("slicc_poll_js") > 0, "slicc_poll_js missing (libuv's poll must enter the kernel)"
assert "slicc_cred_js" in t, "the credential library is missing"
assert not re.search(r"USER\s*:\s*[\"']web_user", t), "Emscripten's getEnvStrings placeholders are linked instead of slicc-env.js (homescoop#1501)"
print("  glue QC OK")
PY
if LC_ALL=C grep -aEq '/(home|Users|__w|private/var)/|homescoop-work' "$OUT/cmake.wasm"; then
  echo "homescoop: cmake.wasm names a build path" >&2
  exit 1
fi

echo "== cmake: stage binary + modules"
rm -rf "$PKG/bin" "$PKG/share"
mkdir -p "$PKG/bin" "$PKG/share/cmake-$SERIES"
cp "$OUT/cmake" "$PKG/bin/cmake"
cp "$OUT/cmake.wasm" "$PKG/bin/cmake.wasm"
chmod +x "$PKG/bin/cmake"
cp -R "$SRC/Modules" "$PKG/share/cmake-$SERIES/Modules"
cp -R "$SRC/Templates" "$PKG/share/cmake-$SERIES/Templates"
cp "$SRC/LICENSE.rst" "$PKG/LICENSE"

# THIRD-PARTY-NOTICES.md (homescoop#844, #1279): the Emscripten runtime and
# every CMake-bundled library the cmake target links (Utilities/cm*, from
# link.txt and linkLibs.rsp), each with its licence file from the source tree.
homescoop_notices_begin "cmake.wasm statically links the following."
homescoop_notice "Emscripten 6.0.9 (runtime and system libraries)" \
  "$EMSCRIPTEN_TREE/LICENSE" - \
  "$EMSCRIPTEN_TREE/system/lib/libc/musl/COPYRIGHT" - \
  "$EMSCRIPTEN_TREE/system/lib/libcxx/LICENSE.TXT" -
homescoop_notice_slicc_shims
BUNDLED=()
while IFS= read -r lib; do BUNDLED+=("$lib"); done < <(grep -ohE "Utilities/cm[a-z0-9]+" "$BLD/Source/CMakeFiles/cmake.dir/link.txt" "$BLD/Source/CMakeFiles/cmake.dir/linkLibs.rsp" | sed 's|Utilities/||' | sort -u)
test "${#BUNDLED[@]}" -gt 5
for lib in "${BUNDLED[@]}"; do
  files=()
  for f in COPYING LICENSE Copyright.txt NOTICE; do
    [[ -f "$SRC/Utilities/$lib/$f" ]] && files+=("$SRC/Utilities/$lib/$f" -)
  done
  if [[ "${#files[@]}" -eq 0 ]] && grep -q 'OSI-approved BSD 3-Clause License' "$SRC/Utilities/$lib"/*.h; then
    files+=("$SRC/LICENSE.rst" -)
  fi
  if [[ "${#files[@]}" -eq 0 ]]; then
    echo "homescoop: Utilities/$lib is linked into cmake.wasm but has no licence file (homescoop#1279)" >&2
    exit 1
  fi
  homescoop_notice "$lib (CMake's bundled copy, Utilities/$lib)" "${files[@]}"
done
echo "== cmake: notices for the Emscripten runtime and ${#BUNDLED[@]} bundled libraries: ${BUNDLED[*]}"
node -e '
const j = require(process.argv[1]);
const want = "${package}/share/cmake-" + process.argv[2];
if (j.slicc?.env?.CMAKE_ROOT !== want || j.slicc?.commands?.cmake?.env?.CMAKE_ROOT !== want) { console.error(`homescoop: package.json CMAKE_ROOT is not ${want}`); process.exit(1); }
' "$PKG/package.json" "$SERIES"
du -sh "$PKG" "$PKG/bin/cmake.wasm" "$PKG/share"

echo "== cmake: PRESTAGE smoke (not --version)"
node "$ROOT/scripts/smoke-cmake.mjs"
echo "OK cmake $PKG_VER"
