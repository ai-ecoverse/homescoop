#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-sysroot

OUT="${1:?usage: build-source.sh <out dir>}"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
export SOURCE_DATE_EPOCH=1756800000 ZERO_AR_DATE=1
DL="$WORK/source-dl"
mkdir -p "$DL"
# The recipe's source: wasix-libc v2026-07-03.1 (SRC_URL/SRC_SHA from recipe.yaml).
LIBC_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$LIBC_TGZ"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe wasix-sysroot --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) fetch_src llvm_linux_x86_64 ;;
  Darwin-arm64) fetch_src llvm_macos_aarch64 ;;
  *) echo "homescoop wasix-sysroot: no pinned wasix LLVM for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
TC="$WORK/source-llvm"
rm -rf "$TC" && mkdir -p "$TC"
tar xzf "$SRC_FILE" -C "$TC"
CL="$TC/bin"
test -x "$CL/clang" && test -x "$CL/llvm-ar" && test -x "$CL/wasm-ld"
echo "== wasix-sysroot (source): $("$CL/clang" --version | sed -n 1p)"

fetch_src llvm_project
LLVM_TGZ="$SRC_FILE"
LLVM_SRC="$WORK/source-llvm-project"
rm -rf "$LLVM_SRC" && mkdir -p "$LLVM_SRC"
top="llvm-project-$(basename "$LLVM_TGZ" .tar.gz)"
tar xzf "$LLVM_TGZ" -C "$LLVM_SRC" --strip-components=1 \
  "$top/compiler-rt" "$top/libcxx" "$top/libcxxabi" "$top/libunwind" "$top/libc" "$top/runtimes" \
  "$top/cmake" "$top/llvm/cmake" "$top/llvm/utils" "$top/third-party"

export PATH="$CL:$PATH"
unset CC CXX CFLAGS CXXFLAGS LDFLAGS CPPFLAGS WASIXCC_MODULE_KIND

variant() {
  local v=$1 eh pic exnref name
  case "$v" in
    sysroot) eh=OFF pic=OFF exnref=ON name=32 ;;
    sysroot-eh) eh=ON pic=OFF exnref=OFF name=32-eh ;;
    sysroot-ehpic) eh=ON pic=ON exnref=OFF name=32-ehpic ;;
    sysroot-exnref-eh) eh=ON pic=OFF exnref=ON name=32-exnref-eh ;;
    sysroot-exnref-ehpic) eh=ON pic=ON exnref=ON name=32-exnref-ehpic ;;
  esac
  local W="$WORK/source-$v"
  rm -rf "$W" && mkdir -p "$W"
  tar xzf "$LIBC_TGZ" -C "$W" --strip-components=1
  rm -rf "$W/tools/llvm-project"
  ln -s "$LLVM_SRC" "$W/tools/llvm-project"
  # -37 (homescoop#1015, #1112): Linux's (and musl's) file-type bits in
  # __mode_t.h, so st_mode means the same as everywhere else: wasi-libc had
  # S_IFIFO 0140000 (Linux's S_IFSOCK), S_IFSOCK 0160000 and S_IFMT 0160000
  # (the OR, which can't mask Linux's FIFO bit). Every libc object is built
  # with these.
  python3 - "$W/libc-bottom-half/headers/public/__mode_t.h" <<'PYMODE'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text()
old = """#define S_IFMT \\
    (S_IFBLK | S_IFCHR | S_IFDIR | S_IFIFO | S_IFLNK | S_IFREG | S_IFSOCK)
#define S_IFBLK (0x6000)
#define S_IFCHR (0x2000)
#define S_IFDIR (0x4000)
#define S_IFLNK (0xa000)
#define S_IFREG (0x8000)
#define S_IFSOCK (0xe000)
#define S_IFIFO (0xc000)
"""
new = """/* homescoop (wasix-sysroot -37): Linux's values (musl's sys/stat.h). */
#define S_IFMT (0170000)
#define S_IFBLK (0060000)
#define S_IFCHR (0020000)
#define S_IFDIR (0040000)
#define S_IFLNK (0120000)
#define S_IFREG (0100000)
#define S_IFSOCK (0140000)
#define S_IFIFO (0010000)
"""
if t.count(old) != 1:
    sys.exit(f"{p}: the S_IF* block isn't wasi-libc's")
p.write_text(t.replace(old, new))
PYMODE
  # upstream's own build script, from the pinned tarball (not this repo).
  (cd "$W" && sed -e 's/^prepare_wasix_libc$/:/' -e "s/-j 16/-j $JOBS/" -e "s/--parallel 16/--parallel $JOBS/" \
    build32-general.sh >build32-homescoop.sh)
  (cd "$W" && grep -qx ':' build32-homescoop.sh) || { echo "homescoop wasix-sysroot: build32-general.sh has no prepare_wasix_libc step to skip" >&2; return 1; }
  local T0 T1
  T0=$(date +%s)
  (cd "$W" && CC="$CL/clang" CXX="$CL/clang++" EH=$eh PIC=$pic EXNREF_EH=$exnref CHECK_SYMBOLS=no bash build32-homescoop.sh) \
    >"$WORK/source-$v.log" 2>&1 || { tail -60 "$WORK/source-$v.log" >&2; return 1; }
  T1=$(date +%s)
  local lib="$W/sysroot$name/lib/wasm32-wasi"
  test -f "$lib/libc.a"
  "$CL/llvm-nm" --defined-only "$lib"/libc.a "$lib"/libwasi-emulated-*.a "$lib"/*.o 2>/dev/null \
    | grep ' [[:upper:]] ' | sed 's/.* [[:upper:]] //' | LC_ALL=C sort -u >"$W/defined.txt"
  "$CL/llvm-nm" --undefined-only "$lib"/libc.a "$lib"/libc-*.a "$lib"/*.o 2>/dev/null \
    | grep ' U ' | sed 's/.* U //' | LC_ALL=C sort -u | LC_ALL=C comm -23 - "$W/defined.txt" \
    | grep '^_*imported_wasix_' >"$lib/libc.imports" || true
  rm -rf "${OUT:?}/$v" && mkdir -p "$OUT"
  cp -R "$W/sysroot$name" "$OUT/$v"
  mv "$OUT/$v/lib/wasm32-wasi" "$OUT/$v/lib/wasm32-wasip1"
  rm -rf "$OUT/$v/include/wasm32-wasi"
  mkdir -p "$OUT/$v/include/wasm32-wasip1"
  echo "  $v: $((T1 - T0)) s (upstream build32-general.sh EH=$eh PIC=$pic EXNREF_EH=$exnref)"
}

echo "== wasix-sysroot (source): $(basename "$LIBC_TGZ") + llvm-project $(basename "$LLVM_TGZ"), five variants"
for v in sysroot sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic; do
  variant "$v"
done

echo "== wasix-sysroot (source): unistd.h declares fork under __wasix__"
"$CL/../bin/clang" --version >/dev/null
OUT="$OUT" python3 - <<'PY'
import os
from pathlib import Path
old = """#if defined(__wasilibc_unmodified_upstream) || !defined(__wasm_exception_handling__)
pid_t fork(void);
pid_t _fork_internal(int copy_mem);
pid_t _Fork(int copy_mem);
#endif"""
new = old.replace("!defined(__wasm_exception_handling__)", "!defined(__wasm_exception_handling__) || defined(__wasix__)")
n = 0
for p in Path(os.environ["OUT"]).glob("sysroot*/include/unistd.h"):
    t = p.read_text()
    if old not in t:
        raise SystemExit(f"homescoop: fork ifdef not found in {p}")
    p.write_text(t.replace(old, new, 1))
    n += 1
print(f"  patched {n} unistd.h")
PY

echo "== wasix-sysroot (source): __gxx_wasm_personality_v0 in the EH trees' libunwind.a (eh-compat/gxx_wasm_personality.c, for wasm-clang 24)"
PC="$WORK/source-personality"
rm -rf "$PC" && mkdir -p "$PC"
for v in sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic; do
  f=(-O2 -fwasm-exceptions -matomics -mbulk-memory -mmutable-globals -pthread "-ffile-prefix-map=$HOMESCOOP_PKG=.")
  [[ $v == *exnref* ]] && f+=(-mllvm --wasm-use-legacy-eh=false)
  [[ $v == *pic ]] && f+=(-fPIC)
  mkdir -p "$PC/$v"
  "$CL/clang" --target=wasm32-wasi "${f[@]}" -c "$HOMESCOOP_PKG/eh-compat/gxx_wasm_personality.c" -o "$PC/$v/gxx_wasm_personality.o"
  "$CL/llvm-ar" r "$OUT/$v/lib/wasm32-wasip1/libunwind.a" "$PC/$v/gxx_wasm_personality.o"
done

echo "== wasix-sysroot (source): fork.o/_Fork.o from the asyncify tree into the static EH trees"
FT="$WORK/source-fork"
rm -rf "$FT" && mkdir -p "$FT"
(cd "$FT" && "$CL/llvm-ar" x "$OUT/sysroot/lib/wasm32-wasip1/libc.a" fork.o _Fork.o && test -s fork.o && test -s _Fork.o)
for v in sysroot-eh sysroot-exnref-eh; do
  lib="$OUT/$v/lib/wasm32-wasip1/libc.a"
  "$CL/llvm-ar" d "$lib" fork.o _Fork.o 2>/dev/null || true
  "$CL/llvm-ar" r "$lib" "$FT/fork.o" "$FT/_Fork.o"
  grep -qx fork.o <<<"$("$CL/llvm-ar" t "$lib")"
done
date -u +%FT%TZ >"$OUT/.done"
echo "== wasix-sysroot (source): staged five variants in $OUT"
