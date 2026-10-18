#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasm-emscripten
OUT_PKG="$HOMESCOOP_PKG/package"
PKG_VER="$(node -p 'require(process.argv[1]).version' "$OUT_PKG/package.json")"
PKG="$WORK/wasm-emscripten-stage"
TB="$WORK/emscripten-$VERSION.tar.gz"
SRC="$WORK/emscripten-$VERSION-src"

homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TB"
rm -rf "$SRC"
mkdir -p "$SRC"
tar -xzf "$TB" -C "$SRC" --strip-components=1
test -f "$SRC/emcc.py"
grep -qx '6.0.9-git' "$SRC/emscripten-version.txt"
test -f "$HOMESCOOP_PKG/emscripten-config"
test -f "$HOMESCOOP_PKG/bin/em-launcher.sh"
test -f "$HOMESCOOP_PKG/lib/slicc-vfs-pre.js"

KEEP="$OUT_PKG"

echo "== wasm-emscripten: stage the 6.0.9 tree (no test/docs/site)"
rm -rf "$PKG"
mkdir -p "$PKG"
rsync -a \
  --exclude='.git/' \
  --exclude='test/' \
  --exclude='docs/' \
  --exclude='site/' \
  --exclude='node_modules/' \
  --exclude='cache/' \
  --exclude='__pycache__/' \
  --exclude='.github/' \
  --exclude='*.pyc' \
  --exclude='.*' \
  "$SRC/" "$PKG/"

echo "== wasm-emscripten: patches"
for p in "$HOMESCOOP_PKG"/patches/*.patch; do
  echo "  patch $(basename "$p")"
  patch -d "$PKG" -p1 --batch --no-backup-if-mismatch < "$p"
done
if find "$PKG" -name '*.rej' -o -name '*.orig' | grep -q .; then
  echo "homescoop: patch leftovers in $PKG" >&2
  exit 1
fi
grep -q 'SLICC_VFS_PRE_JS' "$PKG/tools/link.py"

echo "== wasm-emscripten: entry points"
mkdir -p "$PKG/test"
(cd "$PKG" && python3 tools/maint/create_entry_points.py)
rm -rf "$PKG/test"
test -x "$PKG/tools/file_packager"
test -x "$PKG/tools/webidl_binder"

echo "== wasm-emscripten: host emcc (the same patched tree) on emsdk 6.0.9's prebuilt compilers"
eval "$(bash "$ROOT/scripts/emscripten-tree.sh" "$WORK/em-host" "$TB")"
HOST_EM="$EMSCRIPTEN_TREE"
HOST_EM_CONFIG="$EMSCRIPTEN_TREE_CONFIG"
HOST_CACHE="$EMSCRIPTEN_TREE_CACHE"
HOST_EMCC=(python3 "$HOST_EM/emcc.py")

echo "== wasm-emscripten: libslicc objects for default executable links"
SLICC_SHIMS="$ROOT/shims/slicc"
mkdir -p "$PKG/lib/slicc"
PKG_ALLTYPES="$PKG/system/lib/libc/musl/arch/emscripten/bits/alltypes.h"
grep -q '__bits\[128/sizeof(long)\]' "$PKG_ALLTYPES"
! grep -qE 'typedef struct __sigset_t \{ unsigned long __bits\[2\]; \}' "$PKG_ALLTYPES"
for obj in slicc_spawn slicc_exec slicc_signals slicc_select slicc_libc_gaps slicc_jobs slicc_main_envp slicc_fork; do
  echo "  emcc -c $obj.c"
  EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" -O2 -c "$SLICC_SHIMS/$obj.c" -o "$PKG/lib/slicc/$obj.o"
  test -f "$PKG/lib/slicc/$obj.o"
done
grep -q '__bits\[128/sizeof(long)\]' "$HOST_CACHE/sysroot/include/bits/alltypes.h"
python3 -c "import pathlib,sys; d=pathlib.Path(sys.argv[1]).read_bytes(); sys.exit(0 if b'\\x41\\x8c\\x01' in d else 1)" "$PKG/lib/slicc/slicc_signals.o" || {
  echo "homescoop: slicc_signals.o missing i32.const 140 (sigaction stride)" >&2
  exit 1
}
echo "  PRESTAGE: slicc_signals.o has stride-140 encoding"
for js in slicc-fork.js slicc-writev.js slicc-uname.js; do
  cp "$SLICC_SHIMS/$js" "$PKG/lib/slicc/$js"
done
grep -q "__syscall_linkat__sig: 'iipipi'" "$HOST_EM/src/lib/libsigs.js"
grep -v '__syscall_linkat__sig' "$SLICC_SHIMS/slicc-linkat.js" > "$PKG/lib/slicc/slicc-linkat.js"
grep -q '__syscall_linkat:' "$PKG/lib/slicc/slicc-linkat.js"

echo "== wasm-emscripten: emcc with the packaged tree and read-only package"
PRE_WORK="$WORK/wasm-emscripten-prestage"
rm -rf "$PRE_WORK"
mkdir -p "$PRE_WORK"
printf 'int main(void){return 0;}\n' > "$PRE_WORK/hello.c"
cat > "$PRE_WORK/calls.c" <<'C'
#include <signal.h>
#include <stdio.h>
#include <sys/resource.h>
#include <sys/utsname.h>
#include <unistd.h>
static void on_usr1(int sig) { (void)sig; puts("usr1"); }
int main(void) {
  struct utsname u;
  struct rlimit r;
  int rc = uname(&u);
  printf("uname %d %s\n", rc, u.sysname);
  printf("link %d\n", link("/no-such-src", "/no-such-dst") == -1);
  printf("uid %d\n", (int)getuid());
  printf("rlimit %d\n", getrlimit(RLIMIT_NOFILE, &r));
  signal(SIGUSR1, on_usr1);
  printf("raise %d\n", raise(SIGUSR1));
  return 0;
}
C
chmod -R a-w "$HOST_EM"
RO_CLEANUP() { chmod -R u+w "$HOST_EM" 2>/dev/null || true; }
trap RO_CLEANUP EXIT
unset SLICC_VFS_PRE_JS || true
EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$PKG/lib/slicc" "${HOST_EMCC[@]}" "$PRE_WORK/hello.c" -o "$PRE_WORK/hello.js"
test -f "$PRE_WORK/hello.wasm"
! grep -q 'SLICC_LIVE_FS' "$PRE_WORK/hello.js"
for env_flag in ENVIRONMENT_IS_WEB ENVIRONMENT_IS_WORKER ENVIRONMENT_IS_NODE; do
  grep -q "$env_flag" "$PRE_WORK/hello.js"
done
grep -q sliccKernel "$PRE_WORK/hello.js"
EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$PKG/lib/slicc" "${HOST_EMCC[@]}" -Werror "$PRE_WORK/calls.c" -o "$PRE_WORK/calls.js" 2>"$PRE_WORK/calls.err" || {
  cat "$PRE_WORK/calls.err" >&2
  echo "homescoop: calls.c does not link with -Werror under the packaged defaults (homescoop#1069)" >&2
  exit 1
}
! grep -q 'signature redefinition' "$PRE_WORK/calls.err"
for imp in __syscall_uname slicc_cred_js; do
  grep -q "$imp" "$PRE_WORK/calls.js" || { echo "homescoop: calls.js lacks $imp (homescoop#1056)" >&2; exit 1; }
done
CALLS_OUT="$(node "$PRE_WORK/calls.js")"
printf '%s\n' "$CALLS_OUT"
grep -q '^uname 0 ' <<<"$CALLS_OUT"
grep -q '^link 1$' <<<"$CALLS_OUT"
grep -q '^rlimit 0$' <<<"$CALLS_OUT"
grep -q '^usr1$' <<<"$CALLS_OUT"
grep -q '^raise 0$' <<<"$CALLS_OUT"
if EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" "$PRE_WORK/hello.c" -o "$PRE_WORK/hello-cl.js" --closure=1 2>"$PRE_WORK/closure.err"; then
  echo "homescoop: --closure=1 should have failed" >&2
  exit 1
fi
grep -q "Closure Compiler is not available in SLICC's Emscripten package" "$PRE_WORK/closure.err"
CC_OUT=$(EM_CONFIG="$HOST_EM_CONFIG" python3 "$HOST_EM/emconfigure.py" sh -c 'printf %s "$CC"' 2>/dev/null || true)
echo "$CC_OUT" | grep -q 'emcc'
RO_CLEANUP
trap - EXIT
echo "  PRESTAGE: hello links with the slicc defaults, a program calling uname, link, getuid, getrlimit and raise links with -Werror and runs (#1056, #1069), --closure is refused, emconfigure sets CC"


echo "== wasm-emscripten: config + launchers (+ optional vfs pre-js)"
cp "$HOMESCOOP_PKG/emscripten-config" "$PKG/emscripten-config"
mkdir -p "$PKG/bin" "$PKG/lib"
cp "$HOMESCOOP_PKG/lib/slicc-vfs-pre.js" "$PKG/lib/slicc-vfs-pre.js"
cp "$HOMESCOOP_PKG/bin/em-ensure-cache" "$PKG/bin/em-ensure-cache"
chmod +x "$PKG/bin/em-ensure-cache"

# One launcher script, many argv0 names.
TOOLS=(emcc em++ emar emranlib emcmake emconfigure emmake embuilder em-config emscan-deps)
for t in "${TOOLS[@]}"; do
  cp "$HOMESCOOP_PKG/bin/em-launcher.sh" "$PKG/bin/$t"
  chmod +x "$PKG/bin/$t"
done
# Ensure-cache is not a python tool; already copied.

# Drop upstream bare shims; replace with launchers so embuilder/path_from_root('emcc') works.
for t in emcc em++ emar emranlib emcmake emconfigure emmake embuilder em-config emscan-deps emdwp emnm empath-split emprofile emrun emscons; do
  rm -f "$PKG/$t"
done
# Top-level names used by system_libs rebuilds (path_from_root('emcc')).
for t in emcc em++ emar emranlib emcmake emconfigure emmake embuilder em-config emscan-deps; do
  cp "$PKG/bin/$t" "$PKG/$t"
  chmod +x "$PKG/$t"
done

cp "$PKG/LICENSE" "$PKG/LICENSE" 2>/dev/null || true
test -f "$PKG/LICENSE" && test -f "$PKG/AUTHORS" && test -f "$PKG/SECURITY.md"
cp "$KEEP/package.json" "$PKG/package.json"
cp "$KEEP/README.md" "$PKG/README.md"

echo "== wasm-emscripten: PRESTAGE checks"
# Patches applied
grep -q "Closure Compiler is not available" "$PKG/tools/building.py"
grep -q "Closure Compiler is not available" "$PKG/tools/link.py"
grep -q "ac_cv_build" "$PKG/emconfigure.py"
grep -q "sysroot_install.stamp" "$PKG/tools/cache.py"
grep -q "package symlink" "$PKG/tools/system_libs.py"
grep -q "CMAKE_MAKE_PROGRAM" "$PKG/emcmake.py"
grep -q "SLICC_EMCC_PLAIN" "$PKG/tools/link.py"
grep -q "default_setting('FORCE_FILESYSTEM'" "$PKG/tools/link.py"
grep -q "slicc_spawn.o" "$PKG/tools/link.py"
grep -q "os.execvpe" "$PKG/tools/utils.py"
grep -q "except ImportError" "$PKG/tools/colored_logger.py"
grep -q "except ImportError" "$PKG/tools/file_packager.py"
! grep -rnE --include='*.py' '^import ctypes$|^from ctypes' "$PKG" || {
  echo "homescoop: bare ctypes import still present" >&2
  exit 1
}
test -f "$PKG/lib/slicc-vfs-pre.js"
for obj in slicc_spawn slicc_exec slicc_signals slicc_select slicc_libc_gaps slicc_jobs slicc_main_envp slicc_fork; do
  test -f "$PKG/lib/slicc/$obj.o"
done
for js in slicc-fork.js slicc-writev.js slicc-linkat.js slicc-uname.js; do
  test -f "$PKG/lib/slicc/$js"
done
grep -q "slicc-uname.js" "$PKG/tools/link.py"
grep -q 'Module.sliccPpid' "$PKG/lib/slicc/slicc-fork.js"
grep -q '__syscall_getpid' "$PKG/lib/slicc/slicc_libc_gaps.o" || \
  llvm-nm "$PKG/lib/slicc/slicc_libc_gaps.o" 2>/dev/null | grep -q getpid || true
grep -q "slicc_jobs.o" "$PKG/tools/link.py"
! grep -q "slicc_main_envp.o" "$PKG/tools/link.py" || {
  # may appear in a comment; require it's not in the auto-link tuple alone
  python3 -c 'import pathlib,re; t=pathlib.Path("'"$PKG"'/tools/link.py").read_text(); m=re.search(r"for obj in \((.*?)\):", t, re.S); assert m and "slicc_main_envp" not in m.group(1) and "slicc_jobs" in m.group(1)'
}
test -x "$PKG/bin/emcc"
test -x "$PKG/emcc"
test -x "$PKG/emcmake"
# Root launcher must treat $PKG as package root (emcmake path spawn).
grep -q 'emcc.py' "$PKG/emcc"
grep -q '"emcc"' "$PKG/package.json"  # files list includes root launcher
! grep -q 'SLICC_VFS_PRE_JS:=' "$PKG/emcc" || {
  echo "homescoop: launcher must not default-export SLICC_VFS_PRE_JS" >&2
  exit 1
}
test -f "$PKG/emscripten-config"
! grep -qE "setdefault\(['\"]SLICC_VFS_PRE_JS|SLICC_VFS_PRE_JS\s*=" "$PKG/emscripten-config" || {
  echo "homescoop: emscripten-config must not set SLICC_VFS_PRE_JS" >&2
  exit 1
}
grep -q '"@ai-ecoverse/emscripten-cache": "6.0.9-4"' "$PKG/package.json"
grep -q '"@ai-ecoverse/wasm-binaryen": "132.0.0-3"' "$PKG/package.json"
grep -q '"esbuild-wasm": "0.28.2"' "$PKG/package.json"
grep -q '"typescript": "6.0.3"' "$PKG/package.json"
grep -q '"acorn"' "$PKG/package.json"
grep -q '"acorn-import-phases"' "$PKG/package.json"
! grep -q 'SLICC_VFS_PRE_JS' "$PKG/package.json" || {
  echo "homescoop: package.json slicc.env must not set SLICC_VFS_PRE_JS" >&2
  exit 1
}

! grep -E '/Users/|/home/|/opt/homebrew' "$PKG/emscripten-config" || {
  echo "homescoop: host path leaked into emscripten-config" >&2
  exit 1
}

homescoop_assert_no_package_links "$PKG"
du -sh "$PKG" "$PKG/tools" "$PKG/src" "$PKG/system"
find "$OUT_PKG" -mindepth 1 -maxdepth 1 ! -name package.json ! -name README.md -exec rm -rf {} +
rsync -a --exclude=/package.json --exclude=/README.md "$PKG/" "$OUT_PKG/"
echo "OK wasm-emscripten $PKG_VER"
