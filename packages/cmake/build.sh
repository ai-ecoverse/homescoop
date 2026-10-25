#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
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
CURL_LIBS=(libcurl.a libmbedtls.a libmbedx509.a libmbedcrypto.a libeverest.a libp256m.a libz.a)
for lib in "${CURL_LIBS[@]}"; do
  test -f "$PREFIX/lib/$lib" || { echo "homescoop: missing $PREFIX/lib/$lib (host-run unpacks wasm-curl and wasm-zlib)" >&2; exit 1; }
done
test -f "$PREFIX/include/curl/curl.h" && test -f "$PREFIX/include/zlib.h"
grep -q 'define LIBCURL_VERSION "8.22.0"' "$PREFIX/include/curl/curlver.h"

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

echo "== cmake: libslicc (spawn, exec, signals, libc gaps with credentials, select/poll, sockets and WebCrypto entropy for file(DOWNLOAD))"
ODIR="$WORK/cmake-slicc-objs"
rm -rf "$ODIR"
mkdir -p "$ODIR"
objs=()
for src in slicc_spawn slicc_exec slicc_libc_gaps slicc_signals slicc_select slicc_socket webcrypto-entropy; do
  "${EMCC[@]}" -O2 -c "$ROOT/shims/slicc/${src}.c" -o "$ODIR/${src}.o"
  objs+=("$ODIR/${src}.o")
done
SLICC_A="$ODIR/libslicc-cmake.a"
"${EMAR[@]}" rcs "$SLICC_A" "${objs[@]}"
grep -q sliccKernel "$ODIR/slicc_spawn.o"

echo "== cmake: emcmake (Release, wasm-curl's libcurl with Mbed TLS and wasm-zlib, no dialogs, no tests)"
rm -rf "$BLD"
python3 "$EMSCRIPTEN_TREE/emcmake.py" cmake -S "$SRC" -B "$BLD" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_TESTING=OFF \
  -DCMAKE_USE_SYSTEM_CURL=ON \
  -DCMAKE_USE_SYSTEM_ZLIB=ON \
  "-DCURL_INCLUDE_DIR=$PREFIX/include" \
  "-DCURL_LIBRARY=$PREFIX/lib/libcurl.a" \
  "-DZLIB_INCLUDE_DIR=$PREFIX/include" \
  "-DZLIB_LIBRARY=$PREFIX/lib/libz.a" \
  -DCURL_NO_CURL_CMAKE=ON \
  -DBUILD_CursesDialog=OFF \
  -DBUILD_QtDialog=OFF \
  "-DCMAKE_C_FLAGS=$MAPS" \
  "-DCMAKE_CXX_FLAGS=-fexceptions $MAPS" \
  "-DCMAKE_EXE_LINKER_FLAGS=-fexceptions -sDISABLE_EXCEPTION_CATCHING=0"
test -f "$BLD/Source/CMakeFiles/cmake.dir/link.txt"
grep -qx 'CMAKE_USE_SYSTEM_CURL:BOOL=ON' "$BLD/CMakeCache.txt"
if grep -q 'Utilities/cmcurl' "$BLD/Source/CMakeFiles/cmake.dir/link.txt" "$BLD/Source/CMakeFiles/cmake.dir/linkLibs.rsp" 2>/dev/null; then
  echo "homescoop: cmake still links the bundled TLS-less cmcurl (homescoop#1280)" >&2
  exit 1
fi

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
  "$PREFIX/lib/libmbedtls.a" "$PREFIX/lib/libmbedx509.a" "$PREFIX/lib/libmbedcrypto.a"
  "$PREFIX/lib/libeverest.a" "$PREFIX/lib/libp256m.a" "$PREFIX/lib/libz.a"
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
for lib in cmcurl cmnghttp2 cmzlib; do
  if [[ " ${BUNDLED[*]} " == *" $lib "* ]]; then
    echo "homescoop: cmake.wasm links the bundled $lib; wasm-curl and wasm-zlib replace it (homescoop#1280)" >&2
    exit 1
  fi
done
homescoop_notice "curl / libcurl 8.22.0 (@ai-ecoverse/wasm-curl)" \
  https://raw.githubusercontent.com/curl/curl/curl-8_22_0/COPYING 82f2f4427d6545ee5aaac4f0b80428da6cc8ba41c2cf5da3a03680ec327b9681
homescoop_notice "Mbed TLS 3.6.5 (via @ai-ecoverse/wasm-curl; with Everest and p256-m)" \
  https://raw.githubusercontent.com/Mbed-TLS/mbedtls/mbedtls-3.6.5/LICENSE 9b405ef4c89342f5eae1dd828882f931747f71001cfba7d114801039b52ad09b \
  https://raw.githubusercontent.com/Mbed-TLS/mbedtls/mbedtls-3.6.5/3rdparty/everest/README.md 96a16739f1453480c84b1c787f0d48ea15c1d307af0a2e9baea4d98b0f1d83f2 \
  https://raw.githubusercontent.com/Mbed-TLS/mbedtls/mbedtls-3.6.5/3rdparty/p256-m/README.md 9708f7be7a7775254eacf8d7b3b2961e0905d203bda67c8be95e61c471664e39
homescoop_notice "zlib 1.3.1 (@ai-ecoverse/wasm-zlib)" \
  https://raw.githubusercontent.com/madler/zlib/v1.3.1/LICENSE 845efc77857d485d91fb3e0b884aaa929368c717ae8186b66fe1ed2495753243
echo "== cmake: notices for the Emscripten runtime, ${#BUNDLED[@]} bundled libraries (${BUNDLED[*]}), wasm-curl's curl and Mbed TLS, and wasm-zlib"
node -e '
const j = require(process.argv[1]);
const want = "${package}/share/cmake-" + process.argv[2];
if (j.slicc?.env?.CMAKE_ROOT !== want || j.slicc?.commands?.cmake?.env?.CMAKE_ROOT !== want) { console.error(`homescoop: package.json CMAKE_ROOT is not ${want}`); process.exit(1); }
' "$PKG/package.json" "$SERIES"
du -sh "$PKG" "$PKG/bin/cmake.wasm" "$PKG/share"

echo "== cmake: PRESTAGE smoke (not --version)"
node "$ROOT/scripts/smoke-cmake.mjs"
echo "OK cmake $PKG_VER"
