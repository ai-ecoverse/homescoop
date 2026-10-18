#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe llvm-emscripten
field() { node "$ROOT/scripts/read-recipe.mjs" llvm-emscripten --field "$1"; }
COMMIT="$(field source.commit)"
PKG="$HOMESCOOP_PKG/package"
PKG_WORK="$(cd /tmp && pwd -P)/homescoop-llvm-emscripten-$VERSION"
SRC="$PKG_WORK/llvm-project"
NATIVE="$PKG_WORK/native"
BLD="$PKG_WORK/build"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
TOOLS=(clang lld llvm-ar llvm-nm llvm-objcopy llvm-symbolizer)
mkdir -p "$PKG_WORK"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$PKG_WORK/llvm-project.tar.gz"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$PKG_WORK/llvm-project.tar.gz" -C "$SRC" --strip-components=1
grep -q 'set(LLVM_VERSION_MAJOR 24)' "$SRC/cmake/Modules/LLVMVersion.cmake"

eval "$(bash "$ROOT/scripts/emscripten-tree.sh" "$PKG_WORK/em")"
export EM_CONFIG="$EMSCRIPTEN_TREE_CONFIG"

echo "== llvm-emscripten: native tablegen tools"
rm -rf "$NATIVE"
cmake -G Ninja -S "$SRC/llvm" -B "$NATIVE" -DCMAKE_BUILD_TYPE=Release \
  -DLLVM_ENABLE_PROJECTS=clang -DLLVM_TARGETS_TO_BUILD=WebAssembly \
  -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF \
  -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_LIBXML2=OFF >/dev/null
ninja -C "$NATIVE" -j"$JOBS" llvm-tblgen llvm-min-tblgen clang-tblgen

echo "== llvm-emscripten: emcmake (Release, clang;lld, WebAssembly, no threads)"
rm -rf "$BLD"
MAP="-g0 -ffile-prefix-map=$SRC=/llvm-project -ffile-prefix-map=$BLD=/llvm-project/build -ffile-prefix-map=$EMSCRIPTEN_TREE=/emscripten -ffile-prefix-map=$EMSCRIPTEN_TREE_CACHE=/emscripten/cache"
python3 "$EMSCRIPTEN_TREE/emcmake.py" cmake -GNinja -S "$SRC/llvm" -B "$BLD" \
  -DCMAKE_BUILD_TYPE=Release \
  "-DCMAKE_C_FLAGS=$MAP" "-DCMAKE_CXX_FLAGS=$MAP" \
  "-DLLVM_ENABLE_PROJECTS=clang;lld" \
  -DLLVM_TARGETS_TO_BUILD=WebAssembly \
  -DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten "-DLLVM_DEFAULT_TARGET_TRIPLE=" \
  -DLLVM_ENABLE_THREADS=OFF \
  -DLLVM_ENABLE_LTO=OFF -DLLVM_ENABLE_EH=OFF -DLLVM_ENABLE_RTTI=OFF \
  -DLLVM_ENABLE_PIC=OFF \
  -DLLVM_BUILD_LLVM_DYLIB=OFF \
  -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF -DLLVM_INCLUDE_DOCS=OFF \
  -DCLANG_INCLUDE_TESTS=OFF -DCLANG_INCLUDE_DOCS=OFF \
  -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_LIBEDIT=OFF \
  -DLLVM_ENABLE_LIBPFM=OFF -DLLVM_ENABLE_BINDINGS=OFF -DLLVM_ENABLE_OCAMLDOC=OFF \
  -DLLVM_FORCE_VC_REPOSITORY=https://github.com/llvm/llvm-project.git \
  "-DLLVM_FORCE_VC_REVISION=$COMMIT" \
  "-DLLVM_TABLEGEN=$NATIVE/bin/llvm-tblgen" "-DCLANG_TABLEGEN=$NATIVE/bin/clang-tblgen" \
  "-DLLVM_NATIVE_TOOL_DIR=$NATIVE/bin"

python3 "$HOMESCOOP_PKG/link-edges.py" "$BLD" "$PKG_WORK/edges.json" "${TOOLS[@]}"
mapfile -t TARGETS < <(node -e '
const e = require(process.argv[1]);
const t = new Set();
for (const tool of Object.values(e.tools)) for (const x of [...tool.objects, ...tool.libs]) t.add(x);
console.log([...t].join("\n"));
' "$PKG_WORK/edges.json")
echo "== llvm-emscripten: ninja ${#TARGETS[@]} objects and libraries (no tool links)"
ninja -C "$BLD" -j"$JOBS" "${TARGETS[@]}" clang-resource-headers

echo "== llvm-emscripten: stage package/"
rm -rf "$PKG/lib" "$PKG/objects" "$PKG/include" "$PKG/drivers" "$PKG/manifest.json"
python3 "$HOMESCOOP_PKG/stage.py" "$SRC" "$BLD" "$PKG_WORK/edges.json" "$PKG" "$COMMIT" \
  "$EMSCRIPTEN_TREE" "$EMSCRIPTEN_TREE_CACHE" "$ROOT/packages/wasm-emscripten/patches"
cp "$SRC/llvm/LICENSE.TXT" "$PKG/LICENSE"
if find "$PKG" -type l | grep -q .; then
  echo "homescoop: symlinks in the package" >&2
  exit 1
fi
LEAK="$PKG_WORK|/home/|/Users/|/__w/|/private/var/|/private/tmp/"
if LC_ALL=C grep -rlaE "$LEAK" "$PKG" >/dev/null 2>&1; then
  echo "homescoop: a build path leaked into the package" >&2
  LC_ALL=C grep -rlaE "$LEAK" "$PKG" | head >&2
  exit 1
fi
du -sh "$PKG/lib" "$PKG/objects" "$PKG/include" "$PKG/lib/clang/24"
echo "OK llvm-emscripten $VERSION ($COMMIT)"
