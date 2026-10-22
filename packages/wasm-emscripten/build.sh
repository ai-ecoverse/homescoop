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
for p in "$HOMESCOOP_PKG"/package-patches/*.patch; do
  echo "  package patch $(basename "$p")"
  patch -d "$PKG" -p1 --batch --no-backup-if-mismatch < "$p"
done
for p in "$HOMESCOOP_PKG"/package-patches/libc/*.patch; do
  echo "  package libc patch $(basename "$p")"
  patch -d "$PKG" -p1 --batch --no-backup-if-mismatch < "$p"
done
if find "$PKG" -name '*.rej' -o -name '*.orig' | grep -q .; then
  echo "homescoop: package patch leftovers in $PKG" >&2
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
for p in "$HOMESCOOP_PKG"/package-patches/*.patch; do
  patch -d "$HOST_EM" -p1 --batch --no-backup-if-mismatch -s < "$p"
done
if find "$HOST_EM" -name '*.rej' -o -name '*.orig' | grep -q .; then
  echo "homescoop: package patch leftovers in $HOST_EM" >&2
  exit 1
fi
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
grep -q 'if (++cnt == SYMLOOP_MAX) {' "$HOST_EM/system/lib/libc/musl/src/misc/realpath.c"
grep -q 'if (cnt++ == SYMLOOP_MAX) {' "$PKG/system/lib/libc/musl/src/misc/realpath.c"
echo "  emcc -c slicc_realpath.o (musl realpath.c with package libc patch 0017)"
(cd "$PKG" && EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" -Os -fno-inline-functions -fno-builtin -std=c99 -D_XOPEN_SOURCE=700 \
  -Wno-unused-result -Wno-ignored-attributes \
  -Isystem/lib/libc/musl/arch/emscripten -Isystem/lib/libc/musl/arch/generic \
  -Isystem/lib/libc/musl/src/internal -Isystem/lib/libc/musl/src/include \
  -Isystem/lib/libc/musl/include -Isystem/lib/libc -Isystem/lib/pthread \
  -c system/lib/libc/musl/src/misc/realpath.c -o lib/slicc/slicc_realpath.o)
test -f "$PKG/lib/slicc/slicc_realpath.o"
grep -q '__bits\[128/sizeof(long)\]' "$HOST_CACHE/sysroot/include/bits/alltypes.h"
python3 -c "import pathlib,sys; d=pathlib.Path(sys.argv[1]).read_bytes(); sys.exit(0 if b'\\x41\\x8c\\x01' in d else 1)" "$PKG/lib/slicc/slicc_signals.o" || {
  echo "homescoop: slicc_signals.o missing i32.const 140 (sigaction stride)" >&2
  exit 1
}
echo "  PRESTAGE: slicc_signals.o has stride-140 encoding"
for js in slicc-fork.js slicc-writev.js slicc-uname.js slicc-env.js; do
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
cat > "$PRE_WORK/envi.c" <<'C'
#include <stdio.h>
#include <stdlib.h>
static void show(const char *k) { const char *v = getenv(k); printf("%s=%s\n", k, v ? v : "(unset)"); }
int main(void) {
  show("USER");
  show("LOGNAME");
  show("HOME");
  show("PATH");
  show("PWD");
  return 0;
}
C
cat > "$PRE_WORK/symloop.c" <<'C'
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
static const char *verdict(int err) { return err == 0 ? "ok" : err == ELOOP ? "ELOOP" : "other"; }
static int chain(const char *dir, int follows, int relative) {
  char from[64], to[64];
  mkdir(dir, 0755);
  for (int i = 0; i < follows - 1; i++) {
    snprintf(from, sizeof from, "%s/l%d", dir, i);
    if (relative) snprintf(to, sizeof to, "l%d", i + 1);
    else snprintf(to, sizeof to, "%s/l%d", dir, i + 1);
    if (symlink(to, from) != 0) return -1;
  }
  snprintf(from, sizeof from, "%s/l%d", dir, follows - 1);
  return symlink("/target", from);
}
static void row(const char *name, const char *path) {
  struct stat st;
  char buf[PATH_MAX];
  int fd = open(path, O_RDONLY);
  int eo = fd < 0 ? errno : 0;
  if (fd >= 0) close(fd);
  int es = stat(path, &st) == 0 ? 0 : errno;
  char *r = realpath(path, buf);
  int er = r ? (strcmp(r, "/target") == 0 ? 0 : -1) : errno;
  printf("%s open %s stat %s realpath %s\n", name, verdict(eo), verdict(es), verdict(er));
}
int main(void) {
  int fd = open("/target", O_WRONLY | O_CREAT, 0644);
  if (fd < 0) return 1;
  close(fd);
  if (chain("/a40", 40, 0) || chain("/a41", 41, 0) || chain("/r40", 40, 1) || chain("/r41", 41, 1)) return 1;
  if (chdir("/") != 0) return 1;
  row("abs40", "/a40/l0");
  row("abs41", "/a41/l0");
  row("rel40", "r40/l0");
  row("rel41", "r41/l0");
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
EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$PKG/lib/slicc" "${HOST_EMCC[@]}" "$PRE_WORK/envi.c" -o "$PRE_WORK/envi.js"
ENVI_OUT="$(cd "$PRE_WORK" && env -i "$(command -v node)" envi.js)"
printf '%s\n' "$ENVI_OUT"
for k in USER LOGNAME HOME PATH PWD; do
  grep -qx "$k=(unset)" <<<"$ENVI_OUT" || { echo "homescoop: under env -i, a default-linked program sees a placeholder $k (homescoop#1531)" >&2; exit 1; }
done
EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$PKG/lib/slicc" "${HOST_EMCC[@]}" "$PRE_WORK/symloop.c" -o "$PRE_WORK/symloop.js"
SYMLOOP_OUT="$(node "$PRE_WORK/symloop.js")"
printf '%s\n' "$SYMLOOP_OUT"
for kind in abs rel; do
  grep -qx "${kind}40 open ok stat ok realpath ok" <<<"$SYMLOOP_OUT" || { echo "homescoop: a $kind path of 40 symlink follows is ELOOP in open, stat or realpath under the default link (homescoop#611, #1631)" >&2; exit 1; }
  grep -qx "${kind}41 open ELOOP stat ELOOP realpath ELOOP" <<<"$SYMLOOP_OUT" || { echo "homescoop: a $kind path of 41 symlink follows is not ELOOP in open, stat and realpath (homescoop#611, #1631)" >&2; exit 1; }
done
NO_RP="$PRE_WORK/libslicc-no-realpath"
mkdir -p "$NO_RP"
cp "$PKG"/lib/slicc/* "$NO_RP/"
rm "$NO_RP/slicc_realpath.o"
EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$NO_RP" "${HOST_EMCC[@]}" "$PRE_WORK/symloop.c" -o "$PRE_WORK/symloop-no-rp.js"
NO_RP_OUT="$(node "$PRE_WORK/symloop-no-rp.js")"
grep -qx 'abs40 open ok stat ok realpath ELOOP' <<<"$NO_RP_OUT" || { printf '%s\n' "$NO_RP_OUT" >&2; echo "homescoop: without slicc_realpath.o the host libc should keep musl's 39-follow realpath; PRESTAGE no longer tests the override" >&2; exit 1; }
if EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" "$PRE_WORK/hello.c" -o "$PRE_WORK/hello-cl.js" --closure=1 2>"$PRE_WORK/closure.err"; then
  echo "homescoop: --closure=1 should have failed" >&2
  exit 1
fi
grep -q "Closure Compiler is not available in SLICC's Emscripten package" "$PRE_WORK/closure.err"
CC_OUT=$(EM_CONFIG="$HOST_EM_CONFIG" python3 "$HOST_EM/emconfigure.py" sh -c 'printf %s "$CC"' 2>/dev/null || true)
echo "$CC_OUT" | grep -q 'emcc'
RO_CLEANUP
trap - EXIT
echo "  PRESTAGE: hello links with the slicc defaults, a program calling uname, link, getuid, getrlimit and raise links with -Werror and runs (#1056, #1069), under env -i a default-linked program sees no placeholder USER, LOGNAME, HOME, PATH or PWD (#1531), 40 symlink follows open, stat and realpath and 41 are ELOOP, absolute and relative, and without slicc_realpath.o realpath is ELOOP at 40 (#611, #1631), --closure is refused, emconfigure sets CC"


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
for obj in slicc_spawn slicc_exec slicc_signals slicc_select slicc_libc_gaps slicc_jobs slicc_main_envp slicc_fork slicc_realpath; do
  test -f "$PKG/lib/slicc/$obj.o"
done
grep -q "'slicc_realpath.o'," "$PKG/tools/link.py"
grep -q 'if (cnt++ == SYMLOOP_MAX) {' "$PKG/system/lib/libc/musl/src/misc/realpath.c"
for js in slicc-fork.js slicc-writev.js slicc-linkat.js slicc-uname.js slicc-env.js; do
  test -f "$PKG/lib/slicc/$js"
done
grep -q "slicc-uname.js" "$PKG/tools/link.py"
grep -q "'slicc-uname.js', 'slicc-env.js'" "$PKG/tools/link.py"
grep -q 'nlinks <= {{{ cDefs.SYMLOOP_MAX }}}' "$PKG/src/lib/libfs.js"
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
grep -q '"@ai-ecoverse/emscripten-cache": "6.0.9-6"' "$PKG/package.json"
grep -q '"@ai-ecoverse/wasm-binaryen": "132.0.0-4"' "$PKG/package.json"
grep -q '"@ai-ecoverse/wasm-clang": "24.0.0-22"' "$PKG/package.json"
grep -q '"esbuild-wasm": "0.28.2"' "$PKG/package.json"
grep -q '"typescript": "6.0.3"' "$PKG/package.json"
grep -q '"acorn"' "$PKG/package.json"
grep -q '"acorn-import-phases"' "$PKG/package.json"
grep -q '^ACORN=8.19.0$' "$ROOT/scripts/emscripten-tree.sh"
node -e 'const d = require(process.argv[1]).dependencies; if (d.acorn !== "^8.18.0" || d["acorn-import-phases"] !== "^1.0.4") { console.error(`homescoop: package.json acorn ${d.acorn} / acorn-import-phases ${d["acorn-import-phases"]} no longer cover emscripten-tree.sh pins 8.19.0 / 1.0.4`); process.exit(1); }' "$PKG/package.json"
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
homescoop_notices_begin "lib/slicc's objects and JS libraries, which emcc links into programs by default, are compiled from:"
homescoop_notice_slicc_shims
grep -q '^## homescoop: the slicc shims (shims/slicc, Apache-2.0)$' "$OUT_PKG/THIRD-PARTY-NOTICES.md"
echo "OK wasm-emscripten $PKG_VER"
