#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-zig

field() { node "$ROOT/scripts/read-recipe.mjs" wasi-zig --field "$1"; }
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) zig_host=x86_64-linux; host=linux_x64 ;;
  Darwin-arm64) zig_host=aarch64-macos; host=macos_arm64 ;;
  *) echo "homescoop: no host zig pin for $(uname -sm)" >&2; exit 1 ;;
esac
PKG_WORK="$WORK/wasi-zig"
mkdir -p "$PKG_WORK"
HOST_ZIG_TXZ="$PKG_WORK/zig-$zig_host-$VERSION.tar.xz"
homescoop_fetch "https://ziglang.org/download/$VERSION/zig-$zig_host-$VERSION.tar.xz" "$(field "toolchain.zig_sha256_$host")" "$HOST_ZIG_TXZ"
HOST_ZIG="$PKG_WORK/host-zig-$VERSION"
if [[ ! -x "$HOST_ZIG/zig" ]]; then
  rm -rf "$HOST_ZIG"
  mkdir -p "$HOST_ZIG"
  tar -xJf "$HOST_ZIG_TXZ" -C "$HOST_ZIG" --strip-components=1
fi
export PATH="$HOST_ZIG:$PATH"
unset ZIG_LIB_DIR ZIG_GLOBAL_CACHE_DIR ZIG_LOCAL_CACHE_DIR ZIG_EXE || true
[[ "$(zig version)" == "$VERSION" ]] || { echo "homescoop: host zig $(zig version) != $VERSION" >&2; exit 1; }

HOMESCOOP_WASI_SDK_VERSION="$(field toolchain.wasi-sdk)"
HOMESCOOP_WASI_SDK_SHA="$(field "toolchain.wasi_sdk_sha256_$host")"
export HOMESCOOP_WASI_SDK_VERSION HOMESCOOP_WASI_SDK_SHA
eval "$(bash "$ROOT/scripts/install-wasi-sdk.sh" "$PKG_WORK/$(bash "$ROOT/scripts/install-wasi-sdk.sh" --name)")"
SDK="$WASI_SDK_PATH"
eval "$(node "$ROOT/scripts/recipe-env.mjs" wasi-zig --source wasi_llvm)"
homescoop_fetch "$WASI_LLVM_URL" "$WASI_LLVM_SHA" "$PKG_WORK/wasi-llvm.tgz"
rm -rf "$PKG_WORK/wasi-llvm"
mkdir -p "$PKG_WORK/wasi-llvm"
tar -xzf "$PKG_WORK/wasi-llvm.tgz" -C "$PKG_WORK/wasi-llvm"
LLVM_PREFIX="$PKG_WORK/wasi-llvm/package"
for need in "$LLVM_PREFIX/lib/libLLVMCore.a" "$LLVM_PREFIX/lib/liblldWasm.a" "$SDK/bin/clang++"; do
  test -e "$need" || { echo "homescoop: missing $need" >&2; exit 1; }
done
[[ "$("$LLVM_PREFIX/bin/llvm-config" --version)" == "$(field toolchain.llvm)" ]]

TARBALL="$PKG_WORK/zig-${VERSION}.tar.xz"
SRC="$PKG_WORK/zig-${VERSION}"
ZSRC="$PKG_WORK/zig-llvm-build"
OBJ="$PKG_WORK/llvm-objs"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"
homescoop_extract "$TARBALL" "$SRC"

echo "== wasi-zig (LLVM): patched sources"
rm -rf "$ZSRC" "$OBJ"
cp -a "$SRC" "$ZSRC"
for p in "$HOMESCOOP_PKG"/patches/*.patch; do
  patch -d "$ZSRC" -p1 -s < "$p"
done
mkdir -p "$OBJ/cmake/zigcpp" "$OBJ/out"

TARGET_FLAGS=(--target=wasm32-wasip1-threads "--sysroot=$SDK/share/wasi-sysroot" -pthread -D_WASI_EMULATED_MMAN "-ffile-prefix-map=$PKG_WORK=/wasi-zig")
echo "== wasi-zig (LLVM): libzigcpp.a (wasi-sdk clang++, as zig's CMake builds it)"
for s in zig_llvm zig_llvm-ar zig_clang_driver zig_clang_cc1_main zig_clang_cc1as_main; do
  "$SDK/bin/clang++" "${TARGET_FLAGS[@]}" -O2 -std=c++17 -DLLVM_BUILD_STATIC -DCLANG_BUILD_STATIC \
    -D__STDC_CONSTANT_MACROS -D__STDC_FORMAT_MACROS -D__STDC_LIMIT_MACROS -D_GNU_SOURCE -DNDEBUG \
    -fno-exceptions -fno-rtti -fno-stack-protector -fvisibility-inlines-hidden \
    -Wno-type-limits -Wno-missing-braces -Wno-comment \
    -I"$LLVM_PREFIX/include" -c "$ZSRC/src/$s.cpp" -o "$OBJ/$s.o"
done
"$SDK/bin/llvm-ar" rcs "$OBJ/cmake/zigcpp/libzigcpp.a" "$OBJ"/zig_*.o

libs() { ls "$LLVM_PREFIX"/lib/"$1"*.a | tr '\n' ';' | sed 's/;$//'; }
cat > "$OBJ/cmake/config.h" <<EOF
#ifndef ZIG_CONFIG_H
#define ZIG_CONFIG_H
#define ZIG_VERSION_MAJOR 0
#define ZIG_VERSION_MINOR 16
#define ZIG_VERSION_PATCH 0
#define ZIG_VERSION_STRING "$VERSION"
#define ZIG_CLANG_LIBRARIES "$(libs libclang)"
#define ZIG_CMAKE_BINARY_DIR "$OBJ/cmake"
#define ZIG_CMAKE_PREFIX_PATH ""
#define ZIG_CMAKE_STATIC_LIBRARY_PREFIX "lib"
#define ZIG_CMAKE_STATIC_LIBRARY_SUFFIX ".a"
#define ZIG_CXX_COMPILER "$SDK/bin/clang++"
#define ZIG_CXX_COMPILER_ARG1 "--target=wasm32-wasip1-threads --sysroot=$SDK/share/wasi-sysroot"
#define ZIG_DIA_GUIDS_LIB ""
#define ZIG_LLD_INCLUDE_PATH "$LLVM_PREFIX/include"
#define ZIG_LLD_LIBRARIES "$(libs liblld)"
#define ZIG_LLVM_INCLUDE_PATH "$LLVM_PREFIX/include"
#define ZIG_LLVM_LIBRARIES "$(libs libLLVM)"
#define ZIG_LLVM_LIB_PATH "$LLVM_PREFIX/lib"
#define ZIG_LLVM_LINK_MODE "static"
#define ZIG_SYSTEM_LIBCXX "c++"
#endif
EOF

echo "== wasi-zig (LLVM): zig build (module + options resolution)"
ZIG_BUILD_FLAGS=(-Dtarget=wasm32-wasi -Dcpu=generic+atomics+bulk_memory -Doptimize=ReleaseSmall
  -Denable-llvm "-Dconfig_h=$OBJ/cmake/config.h" -Dsingle-threaded=true -Duse-llvm=true
  -Dno-langref -Dno-lib)
( cd "$ZSRC" && zig build "${ZIG_BUILD_FLAGS[@]}" --prefix "$OBJ/zig-build-prefix" \
    --global-cache-dir "$PKG_WORK/host-cache" --verbose ) > "$OBJ/zig-build.log" 2>&1 || {
  tail -40 "$OBJ/zig-build.log" >&2; exit 1; }

echo "== wasi-zig (LLVM): compiler object without libc"
python3 - "$OBJ/zig-build.log" "$ZSRC/lib" > "$OBJ/build-obj.args" <<'PY'
import sys
log, lib = sys.argv[1:3]
line = next(l for l in open(log) if " build-exe " in l and "-Mroot=" in l and "main.zig" in l)
toks = line.split()
toks = toks[toks.index("build-exe") + 1:]
out, i = [], 0
while i < len(toks):
    t = toks[i]
    if t in ("--stack", "--zig-lib-dir", "--listen"):
        i += 2
        continue
    if t in ("-lc", "-fallow-so-scripts", "-flld") or t.startswith("--listen=") or t.endswith(".a"):
        i += 1
        continue
    out.append(t)
    i += 1
print("\n".join(out + ["--zig-lib-dir", lib]))
PY
( cd "$ZSRC" && xargs zig build-obj -femit-bin="$OBJ/zig-main.o" < "$OBJ/build-obj.args" )

echo "== wasi-zig (LLVM): compiler_rt (f16/f80 helpers wasi-sdk's builtins lack)"
zig build-obj "$ZSRC/lib/compiler_rt.zig" -target wasm32-wasi -mcpu generic+atomics+bulk_memory \
  -fsingle-threaded -OReleaseSmall --name compiler_rt --zig-lib-dir "$ZSRC/lib" \
  --global-cache-dir "$PKG_WORK/host-cache" -femit-bin="$OBJ/compiler_rt.o"
"$SDK/bin/llvm-ar" rcs "$OBJ/libzigrt.a" "$OBJ/compiler_rt.o"
"$SDK/bin/clang" "${TARGET_FLAGS[@]}" -O2 -c "$HOMESCOOP_PKG/llvm-shims.c" -o "$OBJ/llvm-shims.o"

echo "== wasi-zig (LLVM): prebuilt wasi-libc, libc++ and Zig runtimes for the native wasm32-wasi target (0025, 0026)"
PRE="$OBJ/prebuilt"
mkdir -p "$PRE/src" "$PRE/out"
printf 'int main(void) { return 0; }\n' > "$PRE/src/m.c"
printf '#include <string>\nint main() { std::string s("x"); return (int)s.size() - 1; }\n' > "$PRE/src/m.cpp"
( cd "$PRE/src"
  common=(-target wasm32-wasi --zig-lib-dir "$ZSRC/lib" --global-cache-dir "$PRE/gc")
  zig build-exe m.c -lc "${common[@]}" --name mc
  zig build-exe m.c -lc -mexec-model=reactor -fno-entry "${common[@]}" --name mr
  zig build-exe m.cpp -lc -lc++ "${common[@]}" --name mx 2> "$PRE/cxx.log" )
for f in crt1-command.o crt1-reactor.o libc.a libc++.a libc++abi.a libcompiler_rt.a libubsan_rt.a libzigc.a; do
  src=$(find "$PRE/gc/o" -name "$f" -type f)
  test -n "$src" || { echo "homescoop: no $f from the prebuilt build" >&2; exit 1; }
  test "$(printf '%s\n' "$src" | xargs shasum -a 256 | awk '{print $1}' | sort -u | wc -l | tr -d ' ')" = 1 ||
    { echo "homescoop: differing $f from the prebuilt build: $src" >&2; exit 1; }
  cp "$(printf '%s\n' "$src" | head -1)" "$PRE/out/$f"
done

echo "== wasi-zig (LLVM): link zig.wasm (wasi-sdk, threads, imported shared memory)"
"$SDK/bin/clang++" "${TARGET_FLAGS[@]}" -O2 "$OBJ/zig-main.o" "$OBJ/llvm-shims.o" \
  "$OBJ/cmake/zigcpp/libzigcpp.a" "$LLVM_PREFIX"/lib/*.a "$OBJ/libzigrt.a" \
  -ldl -lwasi-emulated-mman -Wl,--import-memory,--export-memory \
  -Wl,--max-memory=4294967296 -Wl,-z,stack-size=48234496 -o "$OBJ/out/zig.wasm"

echo "== PRESTAGE: imports (WASI threads + WASIX process calls + shared env.memory)"
node - "$OBJ/out/zig.wasm" <<'JS'
const m = new WebAssembly.Module(require('fs').readFileSync(process.argv[2]));
const bad = WebAssembly.Module.imports(m).filter((i) =>
  !(i.module === 'wasi_snapshot_preview1' ||
    (i.module === 'wasi' && i.name === 'thread-spawn') ||
    (i.module === 'wasix_32v1' && ['proc_spawn3', 'proc_join', 'proc_id', 'proc_signal', 'fd_pipe'].includes(i.name)) ||
    (i.module === 'env' && i.name === 'memory' && i.kind === 'memory')));
if (bad.length) { console.error('unexpected imports', bad); process.exit(1); }
const ex = WebAssembly.Module.exports(m).map((e) => e.name);
for (const need of ['_start', 'wasi_thread_start', 'memory'])
  if (!ex.includes(need)) { console.error('missing export', need); process.exit(1); }
JS
node "$ROOT/packages/wasi-cargo/check-cargo-wasm.mjs" "$OBJ/out/zig.wasm"

echo "== wasi-zig (LLVM): stage package/"
PKG="$HOMESCOOP_PKG/package"
rm -rf "$PKG/bin" "$PKG/lib"
mkdir -p "$PKG/bin" "$PKG/lib/libc/include"
cp "$OBJ/out/zig.wasm" "$PKG/bin/zig.wasm"
chmod 755 "$PKG/bin/zig.wasm"
L="$ZSRC/lib"
cp -a "$L/std" "$L/compiler_rt.zig" "$L/compiler_rt" "$L/ubsan_rt.zig" "$L/c.zig" "$L/c" "$L/zig.h" \
  "$L/compiler" "$L/init" "$L/include" "$L/libcxx" "$L/libcxxabi" "$L/libunwind" "$PKG/lib/"
find "$PKG/lib/compiler_rt" -name '*_test.zig' -exec sh -c \
  'for f; do printf "// homescoop: compiler_rt test vectors are not shipped.\n" > "$f"; done' _ {} +
( cd "$PKG/lib/include"
  rm -rf openmp_wrappers ppc_wrappers llvm_libc_wrappers
  for h in *.h; do
    case "$h" in
      wasm_simd128.h | builtins.h | float.h | inttypes.h | iso646.h | limits.h | std*.h | \
        tgmath.h | unwind.h | varargs.h | __stdarg_* | __stddef_*) ;;
      *) rm "$h" ;;
    esac
  done )
mkdir -p "$PKG/lib/prebuilt/wasm32-wasi"
cp "$OBJ"/prebuilt/out/* "$PKG/lib/prebuilt/wasm32-wasi/"
cp -a "$L/libc/include/wasm-wasi-musl" "$L/libc/include/generic-musl" "$PKG/lib/libc/include/"
find "$PKG/lib" -type l -exec sh -c 'for l; do t=$(readlink -f "$l"); rm "$l"; cp -a "$t" "$l"; done' _ {} +
cp "$SRC/LICENSE" "$PKG/LICENSE"
cp "$LLVM_PREFIX/LICENSE" "$PKG/LICENSE-LLVM.TXT"
homescoop_notices_begin "zig.wasm is Zig $VERSION's compiler (MIT) linked with LLVM, clang and lld from @ai-ecoverse/wasi-llvm and wasi-sdk 34's libc and libc++. lib/prebuilt holds wasi-libc, libc++ and Zig's runtimes built from Zig's own lib/."
homescoop_notice "wasi_llvm: @ai-ecoverse/wasi-llvm $("$LLVM_PREFIX/bin/llvm-config" --version) (LLVM, clang and lld; Apache-2.0 WITH LLVM-exception)" \
  "$LLVM_PREFIX/LICENSE" -
homescoop_notice "wasi-libc (Zig's lib/libc/wasi, prebuilt in lib/prebuilt; MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception)" \
  "$L/libc/wasi/LICENSE" - "$L/libc/wasi/libc-top-half/musl/COPYRIGHT" - "$L/libc/wasi/libc-bottom-half/cloudlibc/LICENSE" -
homescoop_notice "libc++, libc++abi and libunwind (Zig's lib/libcxx, lib/libcxxabi, lib/libunwind; Apache-2.0 WITH LLVM-exception)" \
  "$L/libcxx/LICENSE.TXT" -
homescoop_assert_no_package_links "$PKG"
du -sh "$PKG" "$PKG/bin/zig.wasm"
shasum -a 256 "$PKG/bin/zig.wasm"
echo "OK wasi-zig (LLVM) $VERSION"
