#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasm-binaryen
PKG="$HOMESCOOP_PKG/package"
PKG_VER="$(node -p 'require(process.argv[1]).version' "$PKG/package.json")"
TB="$WORK/binaryen-$VERSION.tar.gz"
SRC="$WORK/binaryen-$VERSION-src"
BLD="$WORK/binaryen-$VERSION-build"
POST_JS="$ROOT/scripts/slicc-node-main.js"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
TOOLS=(wasm-opt wasm-metadce wasm-emscripten-finalize wasm-ctor-eval wasm-split wasm2js wasm-as wasm-dis)

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$TB" -C "$SRC" --strip-components=1
grep -q 'project(binaryen LANGUAGES C CXX VERSION 132)' "$SRC/CMakeLists.txt"

eval "$(bash "$ROOT/scripts/emscripten-tree.sh" "$WORK/binaryen-em")"
export EM_CONFIG="$EMSCRIPTEN_TREE_CONFIG"
EMCC=(python3 "$EMSCRIPTEN_TREE/emcc.py")
EMXX=(python3 "$EMSCRIPTEN_TREE/em++.py")
EMAR=(python3 "$EMSCRIPTEN_TREE/emar.py")

if [[ ! -f "$BLD/lib/libbinaryen.a" || -n "${FORCE:-}" ]]; then
  echo "== wasm-binaryen: emcmake (Release, emscripten tools only)"
  rm -rf "$BLD"
  python3 "$EMSCRIPTEN_TREE/emcmake.py" cmake -S "$SRC" -B "$BLD" -G "Unix Makefiles" \
    -DCMAKE_BUILD_TYPE=Release \
    "-DCMAKE_C_FLAGS=-ffile-prefix-map=$SRC=/binaryen -ffile-prefix-map=$BLD=/binaryen/build" \
    "-DCMAKE_CXX_FLAGS=-ffile-prefix-map=$SRC=/binaryen -ffile-prefix-map=$BLD=/binaryen/build" \
    -DBUILD_TESTS=OFF \
    -DBUILD_FUZZTEST=OFF \
    -DBUILD_STATIC_LIB=ON \
    -DBUILD_EMSCRIPTEN_TOOLS_ONLY=ON \
    -DENABLE_WERROR=OFF
  make -C "$BLD" -j"$JOBS" "${TOOLS[@]}"
fi
test -f "$BLD/lib/libbinaryen.a"

echo "== wasm-binaryen: libslicc spawn archive"
SLICC_A="$WORK/libslicc-binaryen.a"
ODIR="$WORK/binaryen-slicc-objs"
rm -rf "$ODIR"
mkdir -p "$ODIR"
objs=()
for src in slicc_spawn slicc_exec slicc_libc_gaps slicc_signals; do
  "${EMCC[@]}" -O2 -c "$ROOT/shims/slicc/${src}.c" -o "$ODIR/${src}.o"
  objs+=("$ODIR/${src}.o")
done
"${EMCC[@]}" -O2 -c "$HOMESCOOP_PKG/keep-slicc-spawn.c" -o "$ODIR/keep-slicc-spawn.o"
objs+=("$ODIR/keep-slicc-spawn.o")
rm -f "$SLICC_A"
"${EMAR[@]}" rcs "$SLICC_A" "${objs[@]}"
grep -q sliccKernel "$ODIR/slicc_spawn.o"

"${EMCC[@]}" -O2 -c "$ROOT/shims/slicc/slicc_cred.c" -o "$ODIR/slicc_cred.o"
CRED="$ODIR/libslicc_cred.a"
rm -f "$CRED"
"${EMAR[@]}" rcs "$CRED" "$ODIR/slicc_cred.o"
LDFLAGS_REALM=(
  -sENVIRONMENT=web,worker,node -sEXIT_RUNTIME=1 -sALLOW_MEMORY_GROWTH=1
  -sSTACK_SIZE=8388608 -sFORCE_FILESYSTEM=1 -sINVOKE_RUN=0
  -sEXPORTED_RUNTIME_METHODS=FS,callMain -sDISABLE_EXCEPTION_CATCHING=0
  -sEXPORTED_FUNCTIONS=_main,_homescoop_keep_slicc_spawn -lnodefs.js
  --js-library "$ROOT/shims/slicc/slicc-writev.js"
  --js-library "$ROOT/shims/slicc/slicc-linkat.js"
  --js-library "$ROOT/shims/slicc/slicc-uname.js"
  "--extern-post-js=$POST_JS"
  -Wl,-u,slicc_cred_euid "$CRED"
)

OUT="$WORK/binaryen-relink"
rm -rf "$OUT"
mkdir -p "$OUT"
relink_one() {
  local name=$1
  shift
  local o
  for o in "$@"; do test -f "$o" || { echo "homescoop: missing $o" >&2; exit 1; }; done
  echo "== relink $name"
  "${EMXX[@]}" -O3 -g -fexceptions -fno-rtti "$@" "$BLD/lib/libbinaryen.a" \
    -Wl,--whole-archive "$SLICC_A" -Wl,--no-whole-archive \
    -Wl,-u,homescoop_keep_slicc_spawn \
    "${LDFLAGS_REALM[@]}" \
    -o "$OUT/$name.js"
  mv "$OUT/$name.js" "$OUT/$name"
  "$EMSDK_RELEASE_LLVM/llvm-objcopy" --strip-debug --remove-section=name "$OUT/$name.wasm" "$OUT/$name.stripped.wasm"
  mv "$OUT/$name.stripped.wasm" "$OUT/$name.wasm"
  grep -q sliccKernel "$OUT/$name"
  grep -q "!Module\['noInitialRun'\]" "$OUT/$name"
  grep -q 'slicc_cred_js' "$OUT/$name"
  if LC_ALL=C grep -aEq '/(home|Users|__w|private/var)/' "$OUT/$name.wasm"; then
    echo "homescoop: $name.wasm names a build path" >&2
    exit 1
  fi
}
T="$BLD/src/tools/CMakeFiles"
S="$BLD/src/tools/wasm-split/CMakeFiles"
relink_one wasm-opt "$T/wasm-opt.dir/wasm-opt.cpp.o" "$T/wasm-opt.dir/fuzzing/fuzzing.cpp.o" \
  "$T/wasm-opt.dir/fuzzing/heap-types.cpp.o" "$T/wasm-opt.dir/fuzzing/random.cpp.o" \
  "$T/wasm-opt.dir/fuzzing/parameters.cpp.o"
relink_one wasm-metadce "$T/wasm-metadce.dir/wasm-metadce.cpp.o"
relink_one wasm-emscripten-finalize "$T/wasm-emscripten-finalize.dir/wasm-emscripten-finalize.cpp.o"
relink_one wasm-ctor-eval "$T/wasm-ctor-eval.dir/wasm-ctor-eval.cpp.o"
relink_one wasm2js "$T/wasm2js.dir/wasm2js.cpp.o"
relink_one wasm-as "$T/wasm-as.dir/wasm-as.cpp.o"
relink_one wasm-dis "$T/wasm-dis.dir/wasm-dis.cpp.o"
relink_one wasm-split "$S/wasm-split.dir/wasm-split.cpp.o" "$S/wasm-split.dir/split-options.cpp.o" \
  "$S/wasm-split.dir/instrumenter.cpp.o"

echo "== wasm-binaryen: stage package $PKG_VER"
rm -rf "$PKG/bin"
mkdir -p "$PKG/bin"
for name in "${TOOLS[@]}"; do
  cp "$OUT/$name" "$PKG/bin/$name"
  cp "$OUT/$name.wasm" "$PKG/bin/$name.wasm"
  chmod +x "$PKG/bin/$name" "$PKG/bin/$name.wasm"
done
cp "$SRC/LICENSE" "$PKG/LICENSE"
du -sh "$PKG/bin"/wasm-opt.wasm
node "$ROOT/scripts/smoke-binaryen.mjs"
echo "OK wasm-binaryen $PKG_VER"
