#!/usr/bin/env bash
# Zig 0.16.0 with LLVM 21 (zig cc / zig c++, LLVM-optimized releases) → wasm32-wasi
# for slicc. Stages work/package-llvm/ (bin/zig.wasm, lib/, package.json).
#
# The LLVM, clang and lld libraries come from packages/wasi-llvm (wasi-sdk 24,
# wasm32-wasip1-threads). The compiler's Zig code is built WITHOUT libc, as the
# no-LLVM package's is (its WASI std paths are the ones SLICC certifies); only
# the C++ side links wasi-libc. wasi-libc's crt1 owns `_start` (thread pointer,
# constructors, preopens) and its `main` (llvm-shims.c) runs the compiler
# through std.start (patch 0018).
#
# Env: WASI_LLVM_PREFIX (default ../wasi-llvm/work/prefix), WASI_SDK_PATH
# (default the wasi-sdk 24 that wasi-llvm/build.sh fetched), HOMESCOOP_NPM_VER.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasi-zig

command -v zig >/dev/null || { echo "missing host zig" >&2; exit 1; }
unset ZIG_LIB_DIR ZIG_GLOBAL_CACHE_DIR ZIG_LOCAL_CACHE_DIR ZIG_EXE || true
[[ "$(zig version)" == "$VERSION" ]] || { echo "homescoop: host zig $(zig version) != $VERSION" >&2; exit 1; }

LLVM_PREFIX="${WASI_LLVM_PREFIX:-$ROOT/packages/wasi-llvm/work/prefix}"
SDK="${WASI_SDK_PATH:-$(ls -d "$ROOT"/packages/wasi-llvm/work/wasi-sdk-24.0-* 2>/dev/null | grep -v '\.tar\.gz$' | head -1)}"
for need in "$LLVM_PREFIX/lib/libLLVMCore.a" "$LLVM_PREFIX/lib/liblldWasm.a" "$SDK/bin/clang++"; do
  test -e "$need" || { echo "homescoop: missing $need (run packages/wasi-llvm/build.sh)" >&2; exit 1; }
done
[[ "$("$LLVM_PREFIX/bin/llvm-config" --version)" == 21.* ]]

PKG_WORK="$HOMESCOOP_PKG/work"
mkdir -p "$PKG_WORK"
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

TARGET_FLAGS=(--target=wasm32-wasip1-threads "--sysroot=$SDK/share/wasi-sysroot" -pthread -D_WASI_EMULATED_MMAN)
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

# zig build resolves the compiler's modules and build options (and links a
# throwaway zig.wasm against zig's own wasi-libc, which we do not ship); its
# build-exe command is the recipe for our libc-free object.
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
# Zig builds these the same way on any host; the host zig with the patched lib
# (the shipped sources) builds them once here, so SLICC never has to.
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
  # The same file may be cached by more than one of the builds; it must be one content.
  src=$(find "$PRE/gc/o" -name "$f" -type f)
  test -n "$src" || { echo "homescoop: no $f from the prebuilt build" >&2; exit 1; }
  test "$(printf '%s\n' "$src" | xargs shasum -a 256 | awk '{print $1}' | sort -u | wc -l | tr -d ' ')" = 1 ||
    { echo "homescoop: differing $f from the prebuilt build: $src" >&2; exit 1; }
  cp "$(printf '%s\n' "$src" | head -1)" "$PRE/out/$f"
done

echo "== wasi-zig (LLVM): link zig.wasm (wasi-sdk, threads, imported shared memory)"
# 46 MiB main stack: what zig's build.zig asks for (--stack 48234496).
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
node "$ROOT/packages/wasi-rustc/cargo/check-cargo-wasm.mjs" "$OBJ/out/zig.wasm"

echo "== wasi-zig (LLVM): stage work/package-llvm"
PKG="$PKG_WORK/package-llvm"
rm -rf "$PKG"
mkdir -p "$PKG/bin" "$PKG/lib/libc/include"
cp "$OBJ/out/zig.wasm" "$PKG/bin/zig.wasm"
chmod 755 "$PKG/bin/zig.wasm"
L="$ZSRC/lib"
# Zig's std and runtimes, clang's resource headers (zig cc), wasi-libc's
# headers, and libc++/libc++abi/libunwind for zig c++. wasi-libc's C sources
# (libc/wasi, libc/musl) go to the optional wasi-zig-libc-src package: the
# baseline target links prebuilt archives, other wasm32-wasi CPUs/modes find the
# sources beside this package (patch 0026).
cp -a "$L/std" "$L/compiler_rt.zig" "$L/compiler_rt" "$L/ubsan_rt.zig" "$L/c.zig" "$L/c" "$L/zig.h" \
  "$L/compiler" "$L/init" "$L/include" "$L/libcxx" "$L/libcxxabi" "$L/libunwind" "$PKG/lib/"
# compiler_rt's test vectors (11 MB): Zig loads every @import eagerly, so the
# files stay, empty; test blocks are never analyzed outside `zig test`.
find "$PKG/lib/compiler_rt" -name '*_test.zig' -exec sh -c \
  'for f; do printf "// homescoop: compiler_rt test vectors are not shipped.\n" > "$f"; done' _ {} +
# clang's resource headers for wasm only: no other architecture's intrinsics.
( cd "$PKG/lib/include"
  rm -rf openmp_wrappers ppc_wrappers llvm_libc_wrappers
  for h in *.h; do
    case "$h" in
      wasm_simd128.h | builtins.h | float.h | inttypes.h | iso646.h | limits.h | std*.h | \
        tgmath.h | unwind.h | varargs.h | __stdarg_* | __stddef_*) ;;
      *) rm "$h" ;;
    esac
  done )
SRCPKG="$PKG_WORK/package-libc-src"
rm -rf "$SRCPKG"
mkdir -p "$SRCPKG/lib/libc"
cp -a "$L/libc/wasi" "$L/libc/musl" "$SRCPKG/lib/libc/"
mkdir -p "$PKG/lib/prebuilt/wasm32-wasi"
cp "$OBJ"/prebuilt/out/* "$PKG/lib/prebuilt/wasm32-wasi/"
cp -a "$L/libc/include/wasm-wasi-musl" "$L/libc/include/generic-musl" "$PKG/lib/libc/include/"
find "$PKG/lib" -type l -exec sh -c 'for l; do t=$(readlink -f "$l"); rm "$l"; cp -a "$t" "$l"; done' _ {} +
cp "$SRC/LICENSE" "$PKG/LICENSE"
cp "$LLVM_PREFIX/LICENSE.TXT" "$PKG/LICENSE-LLVM.TXT"

NPM_VER="${HOMESCOOP_NPM_VER:-${VERSION}-15}" node - "$PKG" <<'NODE'
const fs = require('fs');
const [pkgDir] = process.argv.slice(2);
const env = { ZIG_LIB_DIR: '${package}/lib', ZIG_GLOBAL_CACHE_DIR: '${HOME}/.cache/zig', ZIG_EXE: 'zig' };
fs.writeFileSync(`${pkgDir}/package.json`, JSON.stringify({
  name: '@ai-ecoverse/wasi-zig',
  version: process.env.NPM_VER,
  description: 'Zig 0.16.0 compiler with LLVM 21 for slicc WASI (zig cc / c++, LLVM release builds)',
  license: 'MIT AND Apache-2.0 WITH LLVM-exception',
  repository: { type: 'git', url: 'git+https://github.com/ai-ecoverse/homescoop.git', directory: 'packages/wasi-zig' },
  homepage: 'https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasi-zig',
  keywords: ['wasm', 'wasi', 'slicc', 'homescoop', 'zig', 'llvm', 'clang'],
  files: ['README.md', 'LICENSE', 'LICENSE-LLVM.TXT', 'bin', 'lib'],
  publishConfig: { access: 'public' },
  homescoop: { recipe: 'wasi-zig', upstream: '0.16.0', llvm: '21.1.8' },
  slicc: { abi: 'wasi', commands: { zig: { wasm: 'bin/zig.wasm', env } }, env },
}, null, 2) + '\n');
NODE
cat > "$PKG/README.md" <<'EOF'
# @ai-ecoverse/wasi-zig (with LLVM 21)

Zig 0.16.0 for slicc, built for wasm32-wasi with LLVM 21.1.8, clang and lld.

- `zig build-exe` / `run` / `test` / `build`, `-ofmt=c`, all optimize modes,
  with LLVM's optimizer for ReleaseFast / ReleaseSmall / ReleaseSafe.
- `zig cc` / `zig c++` for wasm32-wasi. wasi-libc, libc++ and Zig's runtimes
  (compiler_rt, ubsan_rt, zigc) ship prebuilt for the baseline CPU; another
  CPU or mode (e.g. `-mcpu=generic+simd128`) builds wasi-libc from its C
  sources, in the optional `@ai-ecoverse/wasi-zig-libc-src` package
  (`ipk install @ai-ecoverse/wasi-zig-libc-src`).
- Backends: Debug builds of pure-Zig wasm32 code use Zig's self-hosted wasm
  backend (fast compiles, as in the no-LLVM package); Release modes, programs
  that link libc and C/C++ sources use LLVM. `-fllvm` / `-fno-llvm` (or
  `.use_llvm` on a compile step) override that per build.
- Targets: wasm32 / wasm64 only (the LLVM inside has the WebAssembly target);
  clang's resource headers are trimmed to the ones wasm uses.
- Runs with real threads under slicc (LLVM's thread pool, wasi-threads).

LLVM is Apache-2.0 WITH LLVM-exception (LICENSE-LLVM.TXT); Zig is MIT (LICENSE).
EOF
cp "$SRC/LICENSE" "$SRCPKG/LICENSE"
NPM_VER="${HOMESCOOP_NPM_VER:-${VERSION}-15}" node - "$SRCPKG" <<'NODE'
const fs = require('fs');
const [pkgDir] = process.argv.slice(2);
fs.writeFileSync(`${pkgDir}/package.json`, JSON.stringify({
  name: '@ai-ecoverse/wasi-zig-libc-src',
  version: process.env.NPM_VER,
  description: "wasi-libc's C sources for @ai-ecoverse/wasi-zig: zig cc for wasm32-wasi CPUs and modes beyond the prebuilt baseline",
  license: 'MIT AND Apache-2.0 WITH LLVM-exception',
  repository: { type: 'git', url: 'git+https://github.com/ai-ecoverse/homescoop.git', directory: 'packages/wasi-zig' },
  homepage: 'https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasi-zig',
  keywords: ['wasm', 'wasi', 'slicc', 'homescoop', 'zig', 'libc'],
  files: ['README.md', 'LICENSE', 'lib'],
  publishConfig: { access: 'public' },
  homescoop: { recipe: 'wasi-zig', upstream: '0.16.0' },
}, null, 2) + '\n');
NODE
cat > "$SRCPKG/README.md" <<'EOF'
# @ai-ecoverse/wasi-zig-libc-src

The C sources of Zig 0.16.0's wasi-libc (lib/libc/wasi and lib/libc/musl), for
@ai-ecoverse/wasi-zig in slicc. Install it next to wasi-zig, at the same
version, to link libc for a wasm32-wasi CPU or mode other than the baseline
(for example `-mcpu=generic+simd128`, threads or PIC). The baseline target
needs nothing from here: wasi-zig ships its libc prebuilt.

    ipk install @ai-ecoverse/wasi-zig-libc-src

Licenses: wasi-libc is MIT / Apache-2.0 / Apache-2.0 WITH LLVM-exception
(lib/libc/wasi/LICENSE*); musl is MIT (lib/libc/musl/COPYRIGHT); Zig is MIT
(LICENSE).
EOF
homescoop_assert_no_package_links "$PKG"
homescoop_assert_no_package_links "$SRCPKG"
du -sh "$PKG" "$PKG/bin/zig.wasm" "$SRCPKG"
echo "OK wasi-zig (LLVM) $(node -p "require('$PKG/package.json').version")"
