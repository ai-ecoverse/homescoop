#!/usr/bin/env bash
# Stage the host wasixcc sysroot trees as a data package (no commands).
# Layout matches wasixcc SYSROOT_PREFIX, plus wasm32-wasip1 aliases for clang 24.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
HOMESCOOP_PKG="$ROOT/packages/wasix-sysroot"
PKG_VER="2025.9.30-14"
PKG="$HOMESCOOP_PKG/package"
SRC="${WASIX_SYSROOT:-${HOME}/.wasixcc/sysroot}"

for v in sysroot sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic; do
  test -d "$SRC/$v" || { echo "homescoop: missing $SRC/$v" >&2; exit 1; }
done

echo "== wasix-sysroot: stage from $SRC"
for v in sysroot sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic; do
  rm -rf "$PKG/$v"
  rsync -a --delete "$SRC/$v/" "$PKG/$v/"
done

# clang 24 --target=wasm32-wasip1 looks in lib/wasm32-wasip1. npm/pacote and
# ipk skip symlinks, so wasip1 must be a real directory in the package (not a
# link to wasm32-wasi). Host wasixcc that still wants wasm32-wasi can ln -s
# locally; do not ship that link.
echo "== wasix-sysroot: lib/wasm32-wasip1 as real directory (no package symlinks)"
for v in sysroot sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic; do
  lib="$PKG/$v/lib"
  test -d "$lib/wasm32-wasi" || test -d "$lib/wasm32-wasip1" \
    || { echo "homescoop: missing lib dir in $v" >&2; exit 1; }
  if [[ -L "$lib/wasm32-wasip1" ]]; then
    rm -f "$lib/wasm32-wasip1"
  fi
  if [[ -d "$lib/wasm32-wasi" && ! -d "$lib/wasm32-wasip1" ]]; then
    mv "$lib/wasm32-wasi" "$lib/wasm32-wasip1"
  elif [[ -d "$lib/wasm32-wasi" && -d "$lib/wasm32-wasip1" ]]; then
    # Prefer wasip1 content; drop wasi so the package has one real triple dir.
    rm -rf "$lib/wasm32-wasi"
  fi
  test -d "$lib/wasm32-wasip1"
  test ! -e "$lib/wasm32-wasi"
  # Multiarch include dir (empty; headers live in include/). Real dir, not a link.
  rm -rf "$PKG/$v/include/wasm32-wasi"
  mkdir -p "$PKG/$v/include/wasm32-wasip1"
done

# WASIX + -fwasm-exceptions: upstream unistd.h hides fork() when
# __wasm_exception_handling__ is set. Clangtest (and real WASIX programs) need
# fork with exnref; declare it whenever __wasix__ is defined.
echo "== wasix-sysroot: unistd.h fork under __wasix__"
PKG="$PKG" python3 - <<'PY'
from pathlib import Path
import os
root = Path(os.environ["PKG"])
old = """#if defined(__wasilibc_unmodified_upstream) || !defined(__wasm_exception_handling__)
pid_t fork(void);
pid_t _fork_internal(int copy_mem);
pid_t _Fork(int copy_mem);
#endif"""
new = """#if defined(__wasilibc_unmodified_upstream) || !defined(__wasm_exception_handling__) || defined(__wasix__)
pid_t fork(void);
pid_t _fork_internal(int copy_mem);
pid_t _Fork(int copy_mem);
#endif"""
n = 0
for p in root.glob("sysroot*/include/unistd.h"):
    t = p.read_text()
    if old not in t:
        raise SystemExit(f"homescoop: fork ifdef not found in {p}")
    p.write_text(t.replace(old, new, 1))
    n += 1
print(f"  patched {n} unistd.h")
PY

# EH libc archives ship empty stub fork.o / _Fork.o (no T fork). Restore the
# real objects from the asyncify sysroot so default exnref links still get fork.
# Keep each EH tree's own vfork.o (setjmp/longjmp + __wasm_longjmp path).
echo "== wasix-sysroot: inject fork/_Fork into EH libc.a"
LLVM_AR="${LLVM_AR:-}"
if [[ -z "$LLVM_AR" ]]; then
  for cand in \
    "${HOME}/.wasixcc/llvm/bin/llvm-ar" \
    "$(command -v llvm-ar 2>/dev/null || true)"
  do
    if [[ -n "$cand" && -x "$cand" ]]; then
      LLVM_AR=$cand
      break
    fi
  done
fi
[[ -n "$LLVM_AR" && -x "$LLVM_AR" ]] || {
  echo "homescoop: need llvm-ar to inject fork objects" >&2
  exit 1
}
FORK_TMP=$(mktemp -d)
trap 'rm -rf "$FORK_TMP"' EXIT
(
  cd "$FORK_TMP"
  "$LLVM_AR" x "$PKG/sysroot/lib/wasm32-wasip1/libc.a" fork.o _Fork.o
  test -s fork.o && test -s _Fork.o
)
for v in sysroot-eh sysroot-exnref-eh; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  "$LLVM_AR" d "$lib" fork.o _Fork.o 2>/dev/null || true
  "$LLVM_AR" r "$lib" "$FORK_TMP/fork.o" "$FORK_TMP/_Fork.o"
  if ! "$LLVM_AR" t "$lib" | grep -qx 'fork.o'; then
    echo "homescoop: fork.o missing after inject into $lib" >&2
    exit 1
  fi
  echo "  injected into $v (static; ehpic keeps upstream stubs — asyncify fork.o is non-PIC)"
done
rm -rf "$FORK_TMP"
trap - EXIT

# Passwd-less SLICC realm: uid/gid 1000, user /home/user (matches wasix-python stubs).
echo "== wasix-sysroot: inject slicc identity into every libc.a"
CLANG="${HOME}/.wasixcc/llvm/bin/clang"
test -x "$CLANG" || { echo "homescoop: need $CLANG to compile slicc_identity.c" >&2; exit 1; }
ID_SRC="$HOMESCOOP_PKG/slicc_identity.c"
ID_TMP=$(mktemp -d)
trap 'rm -rf "$ID_TMP"' EXIT
compile_id() {
  local out=$1; shift
  "$CLANG" --target=wasm32-wasip1 --sysroot="$PKG/sysroot" \
    -resource-dir="${HOME}/.wasixcc/llvm/lib/clang/21" \
    "$@" -c "$ID_SRC" -o "$out"
  test -s "$out"
}
compile_id "$ID_TMP/slicc_identity.o"
compile_id "$ID_TMP/slicc_identity.pic.o" -fPIC -fvisibility=default
DROP=(getuid.o geteuid.o getgid.o getegid.o getpwent.o getpw_r.o getgrent.o getgr_r.o)
install_identity() {
  local lib=$1 src=$2
  [[ -f "$lib" ]] || return 0
  "$LLVM_AR" d "$lib" "${DROP[@]}" 2>/dev/null || true
  # Member must be slicc_identity.o
  cp "$src" "$ID_TMP/slicc_identity.o"
  "$LLVM_AR" r "$lib" "$ID_TMP/slicc_identity.o"
}
for v in sysroot sysroot-eh sysroot-exnref-eh; do
  for triple in wasm32-wasip1 wasm32-wasi; do
    lib="$PKG/$v/lib/$triple/libc.a"
    [[ -f "$lib" ]] || continue
    install_identity "$lib" "$ID_TMP/slicc_identity.o"
    echo "  identity → $v/$triple"
  done
done
for v in sysroot-ehpic sysroot-exnref-ehpic; do
  for triple in wasm32-wasip1 wasm32-wasi; do
    lib="$PKG/$v/lib/$triple/libc.a"
    [[ -f "$lib" ]] || continue
    install_identity "$lib" "$ID_TMP/slicc_identity.pic.o"
    echo "  identity (PIC) → $v/$triple"
  done
done
# Host wasixcc trees: wasixcc links wasm32-wasi; without this getuid stays 0.
if [[ -d "${HOME}/.wasixcc/sysroot" ]]; then
  for v in sysroot sysroot-eh sysroot-exnref-eh; do
    for triple in wasm32-wasip1 wasm32-wasi; do
      hlib="${HOME}/.wasixcc/sysroot/$v/lib/$triple/libc.a"
      [[ -f "$hlib" ]] || continue
      install_identity "$hlib" "$ID_TMP/slicc_identity.o"
      echo "  identity → host $v/$triple"
    done
  done
  for v in sysroot-ehpic sysroot-exnref-ehpic; do
    for triple in wasm32-wasip1 wasm32-wasi; do
      hlib="${HOME}/.wasixcc/sysroot/$v/lib/$triple/libc.a"
      [[ -f "$hlib" ]] || continue
      install_identity "$hlib" "$ID_TMP/slicc_identity.pic.o"
      echo "  identity (PIC) → host $v/$triple"
    done
  done
fi
rm -rf "$ID_TMP"
trap - EXIT

# Upstream wasix-libc fcntl F_SETFD: `flags | FD_CLOEXEC ? ...` is always true
# (operator precedence), so clearing CLOEXEC still sets it. Fix before shipping.
echo "== wasix-sysroot: inject fixed fcntl.o (F_SETFD CLOEXEC precedence)"
FCNTL_SRC="$HOMESCOOP_PKG/patches/fcntl.c"
test -f "$FCNTL_SRC" || { echo "homescoop: missing $FCNTL_SRC" >&2; exit 1; }
FCNTL_TMP=$(mktemp -d)
trap 'rm -rf "$FCNTL_TMP"' EXIT
compile_fcntl() {
  local out=$1; shift
  # Must match wasixcc object features (atomics/bulk-memory) or wasm-ld
  # rejects --shared-memory when this member is pulled in.
  "$CLANG" --target=wasm32-wasip1 --sysroot="$PKG/sysroot" \
    -resource-dir="${HOME}/.wasixcc/llvm/lib/clang/21" \
    -I"$PKG/sysroot/include" \
    -matomics -mbulk-memory -mmutable-globals -pthread \
    -fno-trapping-math -ftls-model=local-exec \
    -msimd128 -mrelaxed-simd -mextended-const -O2 \
    "$@" -c "$FCNTL_SRC" -o "$out"
  test -s "$out"
}
compile_fcntl "$FCNTL_TMP/fcntl.static.o"
compile_fcntl "$FCNTL_TMP/fcntl.pic.o" -fPIC -fvisibility=default
# Archive member must be named fcntl.o.
install_fcntl() {
  local lib=$1 src=$2
  cp "$src" "$FCNTL_TMP/fcntl.o"
  "$LLVM_AR" d "$lib" fcntl.o 2>/dev/null || true
  "$LLVM_AR" r "$lib" "$FCNTL_TMP/fcntl.o"
}
for v in sysroot sysroot-eh sysroot-exnref-eh; do
  install_fcntl "$PKG/$v/lib/wasm32-wasip1/libc.a" "$FCNTL_TMP/fcntl.static.o"
  echo "  fcntl → $v"
done
for v in sysroot-ehpic sysroot-exnref-ehpic; do
  install_fcntl "$PKG/$v/lib/wasm32-wasip1/libc.a" "$FCNTL_TMP/fcntl.pic.o"
  echo "  fcntl (PIC) → $v"
done
# Host wasixcc trees (local wasixcc / perl builds).
if [[ -d "${HOME}/.wasixcc/sysroot" ]]; then
  for v in sysroot sysroot-eh sysroot-exnref-eh; do
    for triple in wasm32-wasip1 wasm32-wasi; do
      hlib="${HOME}/.wasixcc/sysroot/$v/lib/$triple/libc.a"
      [[ -f "$hlib" ]] || continue
      install_fcntl "$hlib" "$FCNTL_TMP/fcntl.static.o"
      echo "  fcntl → host $v/$triple"
    done
  done
  for v in sysroot-ehpic sysroot-exnref-ehpic; do
    for triple in wasm32-wasip1 wasm32-wasi; do
      hlib="${HOME}/.wasixcc/sysroot/$v/lib/$triple/libc.a"
      [[ -f "$hlib" ]] || continue
      install_fcntl "$hlib" "$FCNTL_TMP/fcntl.pic.o"
      echo "  fcntl (PIC) → host $v/$triple"
    done
  done
fi
rm -rf "$FCNTL_TMP"
trap - EXIT

# Full libc++ / libc++abi / libunwind from the same LLVM as wasm-clang
# (b158b0ae6), all exnref. Mixing a rebuilt personality into wasix's clang-21
# libc++abi left throws uncaught (LSDA/typeinfo contract mismatch).
echo "== wasix-sysroot: install clang-24 exnref C++ runtimes"
CXX_OUT="$HOMESCOOP_PKG/.cxx-runtimes"
if [[ ! -f "$CXX_OUT/install-static/lib/wasm32-wasi/libc++abi.a" \
   || ! -f "$CXX_OUT/install-pic/lib/wasm32-wasi/libc++abi.a" ]]; then
  bash "$HOMESCOOP_PKG/rebuild-cxx-runtimes.sh"
fi
# Header-only: wasi must use musl locale API, not ibm.h (strtod_l clash with wasix-libc).
MUSL_H="${HOME}/.wasixcc/sysroot/sysroot-exnref-eh/include/c++/v1/__locale_dir/locale_base_api/musl.h"
chmod +x "$HOMESCOOP_PKG/fix-cxx-musl-headers.sh"
bash "$HOMESCOOP_PKG/fix-cxx-musl-headers.sh" "$CXX_OUT/install-static" "$MUSL_H"
bash "$HOMESCOOP_PKG/fix-cxx-musl-headers.sh" "$CXX_OUT/install-pic" "$MUSL_H"
install_cxx() {
  local dest=$1 src=$2
  # CMake installs rebuilt runtimes under lib/wasm32-wasi (LIBDIR_SUFFIX);
  # the package triple dir is wasm32-wasip1.
  local libdir="$dest/lib/wasm32-wasip1"
  mkdir -p "$libdir"
  cp "$src/lib/wasm32-wasi/libc++.a" "$libdir/libc++.a"
  cp "$src/lib/wasm32-wasi/libc++abi.a" "$libdir/libc++abi.a"
  cp "$src/lib/wasm32-wasi/libunwind.a" "$libdir/libunwind.a"
  [[ -f "$src/lib/wasm32-wasi/libc++.modules.json" ]] \
    && cp "$src/lib/wasm32-wasi/libc++.modules.json" "$libdir/libc++.modules.json"
  rm -rf "$dest/include/c++"
  mkdir -p "$dest/include"
  rsync -a "$src/include/c++" "$dest/include/"
  for h in libunwind.h unwind.h __libunwind_config.h libunwind.modulemap \
           unwind_arm_ehabi.h unwind_itanium.h unwind_wasm.h; do
    [[ -f "$src/include/$h" ]] && cp "$src/include/$h" "$dest/include/$h"
  done
  if [[ -d "$src/include/mach-o" ]]; then
    rm -rf "$dest/include/mach-o"
    rsync -a "$src/include/mach-o" "$dest/include/"
  fi
  if [[ -d "$src/share/libc++" ]]; then
    rm -rf "$dest/share/libc++"
    mkdir -p "$dest/share"
    rsync -a "$src/share/libc++" "$dest/share/"
  fi
  bash "$HOMESCOOP_PKG/fix-cxx-musl-headers.sh" "$dest" "$MUSL_H"
  echo "  C++ runtimes → $dest"
}
for v in sysroot-eh sysroot-exnref-eh; do
  install_cxx "$PKG/$v" "$CXX_OUT/install-static"
done
for v in sysroot-ehpic sysroot-exnref-ehpic; do
  install_cxx "$PKG/$v" "$CXX_OUT/install-pic"
done
OBJDUMP="${LLVM_OBJDUMP:-}"
if [[ -z "$OBJDUMP" ]]; then
  for cand in \
    "$ROOT/../slicc-emscripten/install/bin/llvm-objdump" \
    "${HOME}/.wasixcc/llvm/bin/llvm-objdump" \
    "$(command -v llvm-objdump 2>/dev/null || true)"
  do
    if [[ -n "$cand" && -x "$cand" ]]; then OBJDUMP=$cand; break; fi
  done
fi
EH_TMP=$(mktemp -d)
trap 'rm -rf "$EH_TMP"' EXIT
(
  cd "$EH_TMP"
  "$LLVM_AR" x "$PKG/sysroot-exnref-eh/lib/wasm32-wasip1/libc++abi.a"
  if ! "$LLVM_AR" t "$PKG/sysroot-exnref-eh/lib/wasm32-wasip1/libc++abi.a" | grep -q 'cxa_personality'; then
    echo "homescoop: cxa_personality missing in rebuilt libc++abi" >&2
    exit 1
  fi
  if [[ -n "$OBJDUMP" ]]; then
    OBJDUMP="$OBJDUMP" python3 - <<'PY'
import os, re, subprocess, sys, pathlib
legacy, new = [], []
for p in pathlib.Path('.').glob('*.o'):
    out = subprocess.check_output([os.environ["OBJDUMP"], "-d", str(p)], text=True, errors="replace")
    legacy += re.findall(r"\t(try|catch|catch_all|rethrow|delegate)\b", out)
    new += re.findall(r"\t(try_table|throw_ref|catch_ref|catch_all_ref)\b", out)
if legacy:
    print("homescoop: PRESTAGE fail — libc++abi legacy opcodes:", sorted(set(legacy)), file=sys.stderr)
    sys.exit(1)
if not new:
    print("homescoop: PRESTAGE fail — libc++abi missing exnref opcodes", file=sys.stderr)
    sys.exit(1)
print(f"  PRESTAGE: libc++abi exnref ok ({len(new)} new EH ops, no legacy)")
PY
  fi
  if ! grep -q 'locale_base_api/musl.h' "$PKG/sysroot-exnref-eh/include/c++/v1/__locale_dir/locale_base_api.h"; then
    echo "homescoop: PRESTAGE fail — locale_base_api.h missing musl.h include" >&2
    exit 1
  fi
  echo "  PRESTAGE: locale_base_api uses musl.h"
  # Layout gate before tarball PRESTAGE (compile runs against extracted .tgz).
  for v in sysroot sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic; do
    [[ -d "$PKG/$v/lib/wasm32-wasip1" && ! -L "$PKG/$v/lib/wasm32-wasip1" ]] \
      || { echo "homescoop: PRESTAGE fail — $v/lib/wasm32-wasip1 must be a real directory" >&2; exit 1; }
    [[ ! -e "$PKG/$v/lib/wasm32-wasi" ]] \
      || { echo "homescoop: PRESTAGE fail — $v still has lib/wasm32-wasi (ship wasip1 only)" >&2; exit 1; }
    test -f "$PKG/$v/lib/wasm32-wasip1/crt1.o"
    test -f "$PKG/$v/lib/wasm32-wasip1/libc.a"
  done
  echo "  PRESTAGE: lib/wasm32-wasip1 real dirs + crt1.o/libc.a present"
)
rm -rf "$EH_TMP"
trap - EXIT

cat > "$PKG/LICENSE" <<'EOF'
Apache-2.0 WITH LLVM-exception

This package redistributes wasix-libc sysroot contents (headers, libc, libc++,
compiler-rt builtins) as built/installed by wasixcc. See
https://github.com/wasix-org/wasix-libc for upstream terms.
EOF

cat > "$PKG/README.md" <<'EOF'
# @ai-ecoverse/wasix-sysroot

WASIX libc/libcxx/compiler-rt sysroots, laid out as a wasixcc `SYSROOT_PREFIX`:

- `sysroot` — no wasm exceptions (asyncify path)
- `sysroot-eh` / `sysroot-ehpic` — legacy EH, static / PIC
- `sysroot-exnref-eh` / `sysroot-exnref-ehpic` — exnref EH, static / PIC

Each tree has a real `lib/wasm32-wasip1` (not a symlink — npm/ipk skip
links). clang 24 `--target=wasm32-wasip1` resolves crt/libc there.
`unistd.h` declares `fork` under `__wasix__` even with `-fwasm-exceptions`.
EH `libc.a` archives get real `fork`/`_Fork` from asyncify (static trees).
Every libc embeds SLICC identity stubs. EH trees ship libc++/libc++abi/
libunwind rebuilt from LLVM b158b0ae6 (same as wasm-clang) with exnref flags.

Data only — no commands. Set `WASIXCC_SYSROOT_PREFIX` to this package directory.
EOF

node -e '
const fs = require("fs");
const p = process.argv[1];
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.version = process.argv[2];
j.description = "WASIX sysroots: wasip1 real dirs (no symlinks), clang24 exnref EH";
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
' "$PKG/package.json" "$PKG_VER"

cp "$HOMESCOOP_PKG/PRESTAGE.md" "$PKG/PRESTAGE.md"

echo "== PRESTAGE: pack + link from extracted tarball (what users install)"
homescoop_assert_no_package_links "$PKG"
PACK_DIR=$(mktemp -d)
trap 'rm -rf "$PACK_DIR"' EXIT
TGZ=$(homescoop_npm_pack_no_links "$PKG" "$PACK_DIR")
EXTRACT="$PACK_DIR/extract"
mkdir -p "$EXTRACT"
tar xzf "$TGZ" -C "$EXTRACT" --no-same-owner
EXT_PKG="$EXTRACT/package"
[[ -d "$EXT_PKG/sysroot-exnref-eh/lib/wasm32-wasip1" && ! -L "$EXT_PKG/sysroot-exnref-eh/lib/wasm32-wasip1" ]]
test -f "$EXT_PKG/sysroot-exnref-eh/lib/wasm32-wasip1/crt1.o"
test -f "$EXT_PKG/sysroot-exnref-eh/lib/wasm32-wasip1/libc.a"
echo "  PRESTAGE: extracted tarball has real wasm32-wasip1 + crt1.o"

SLICC_EM="${SLICC_EMSCRIPTEN:-$ROOT/../slicc-emscripten}"
HOST_CLANGXX="${CLANGXX_HOST:-$SLICC_EM/install/bin/clang++}"
if [[ -x "$HOST_CLANGXX" ]] && command -v node >/dev/null && command -v wasmer >/dev/null; then
  SYS="$EXT_PKG/sysroot-exnref-eh"
  RES="$("$HOST_CLANGXX" -print-resource-dir)"
  [[ -d "$ROOT/packages/wasm-clang/package/lib/clang/24" ]] \
    && RES="$ROOT/packages/wasm-clang/package/lib/clang/24"
  RUN="$PACK_DIR/run"
  mkdir -p "$RUN"
  (
    cd "$RUN"
    CXXFLAGS=(
      --target=wasm32-wasip1 --sysroot="$SYS" -resource-dir="$RES"
      -O2 -matomics -mbulk-memory -mmutable-globals -pthread -ftls-model=local-exec
      -fwasm-exceptions -mllvm --wasm-enable-sjlj -mllvm --wasm-use-legacy-eh=false
      -Wl,--extra-features=atomics -Wl,--extra-features=bulk-memory
      -Wl,--extra-features=mutable-globals -Wl,--shared-memory
      -Wl,--import-memory -Wl,--export-memory
      -Wl,--max-memory=4294967296
      -Wl,-mllvm,--wasm-use-legacy-eh=false -Wl,-mllvm,--exception-model=wasm
      -lc++ -lc++abi -lunwind
      -lwasi-emulated-getpid -lwasi-emulated-mman -lwasi-emulated-process-clocks
      -lclang_rt.builtins-wasm32 -lpthread
    )
    cat > p1.cpp <<'EOF'
#include <iostream>
int main() { std::cout << "plain cxx\n"; }
EOF
    cat > p2.cpp <<'EOF'
#include <stdexcept>
#include <cstdio>
int main() {
  try { throw std::runtime_error("x"); }
  catch (const std::exception& e) { std::printf("caught %s\n", e.what()); }
}
EOF
    cat > p3.cpp <<'EOF'
#include <thread>
#include <cstdio>
int main() {
  int n = 0;
  std::thread t([&] { n = 5; });
  t.join();
  std::printf("thread %d\n", n);
}
EOF
    cat > t.cpp <<'EOF'
#include <iostream>
#include <stdexcept>
#include <thread>
#include <vector>
#include <atomic>
int main() {
  try { throw std::runtime_error("boom"); }
  catch (const std::exception& e) { std::cout << "caught " << e.what() << "\n"; }
  std::atomic<int> n{0};
  std::vector<std::thread> ts;
  for (int i = 0; i < 4; i++) ts.emplace_back([&] { n += 10; });
  for (auto& th : ts) th.join();
  std::cout << "threads " << n << "\n";
}
EOF
    for src in p1 p2 p3 t; do
      "$HOST_CLANGXX" "${CXXFLAGS[@]}" "$src.cpp" -o "$src.wasm" \
        || { echo "homescoop: PRESTAGE fail — compile $src against extracted tgz" >&2; exit 1; }
      echo "  PRESTAGE: compiled $src (from tgz)"
    done
    node - <<'NODE'
const { spawnSync } = require('child_process');
const fs = require('fs');
const cases = [
  ['p1.wasm', 'plain cxx'],
  ['p2.wasm', 'caught x'],
  ['p3.wasm', 'thread 5'],
  ['t.wasm', 'caught boom'],
];
for (const [bin, expect] of cases) {
  const r = spawnSync('wasmer', ['run', bin], { encoding: 'utf8' });
  fs.writeFileSync(bin + '.out', r.stdout || '');
  if (r.status !== 0) {
    console.error('homescoop: PRESTAGE fail —', bin, (r.stdout || '') + (r.stderr || ''));
    process.exit(1);
  }
  if (!(r.stdout || '').includes(expect)) {
    console.error('homescoop: PRESTAGE fail —', bin, 'got', JSON.stringify(r.stdout), 'want', expect);
    process.exit(1);
  }
  console.log('  PRESTAGE:', bin, 'tgz/wasmer ok');
}
const t = fs.readFileSync('t.wasm.out', 'utf8');
if (!t.includes('threads 40')) {
  console.error('homescoop: PRESTAGE fail — t missing threads 40:', t);
  process.exit(1);
}
NODE
  )
else
  echo "  PRESTAGE: skip tgz C++ link (need host clang++/node/wasmer)"
fi
# Keep a copy of the verified tarball next to the package for staging handoff.
cp "$TGZ" "$HOMESCOOP_PKG/ai-ecoverse-wasix-sysroot-${PKG_VER}.tgz"
rm -rf "$PACK_DIR"
trap - EXIT

echo "== wasix-sysroot: sized"
du -sh "$PKG" "$PKG"/sysroot*
ls -la "$PKG/sysroot-exnref-eh/lib/"
echo "OK wasix-sysroot $PKG_VER"
