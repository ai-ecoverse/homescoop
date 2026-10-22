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
SLICC_NM="$EMSDK_RELEASE_LLVM/llvm-nm"
slicc_renames() {
  local prefix=$1 sym out=()
  shift
  for sym in "$@"; do out+=("-D$sym=${prefix}_$sym"); done
  echo "${out[*]:-}"
}
slicc_libc_overrides() {
  case "$1" in
    slicc_signals) echo kill ;;
    slicc_select) echo poll pselect ;;
    slicc_libc_gaps) echo nanosleep setuid setgid seteuid setegid setreuid setregid setresuid setresgid ;;
    slicc_jobs) echo tcgetpgrp tcsetpgrp ;;
  esac
}
SLICC_OVERRIDE_OBJS=(slicc_signals slicc_select slicc_libc_gaps)
for obj in slicc_spawn slicc_exec slicc_signals slicc_select slicc_libc_gaps slicc_main_envp slicc_fork; do
  read -ra overrides <<<"$(slicc_libc_overrides "$obj")"
  read -ra flags <<<"$(slicc_renames "$obj" "${overrides[@]}")"
  echo "  emcc -c $obj.c${overrides[*]:+ with ${overrides[*]} renamed ${obj}_<name>}"
  EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" -O2 "${flags[@]}" -c "$SLICC_SHIMS/$obj.c" -o "$PKG/lib/slicc/$obj.o"
  test -f "$PKG/lib/slicc/$obj.o"
done
slicc_globals() {
  "$SLICC_NM" --defined-only --extern-only "$@" | awk '$2 ~ /^[A-Z]$/ && $3 !~ /^__em_js/ {print $3}'
}
echo "  emcc -c slicc_jobs.c into slicc_jobs.o without tcgetpgrp/tcsetpgrp, and into lib/slicc/libslicc_jobs.a, one member per override"
read -ra flags <<<"$(slicc_renames slicc_jobs tcgetpgrp tcsetpgrp)"
EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" -O2 "${flags[@]}" -c "$SLICC_SHIMS/slicc_jobs.c" -o "$PKG/lib/slicc/slicc_jobs.o"
if grep -qxE 'tcgetpgrp|tcsetpgrp' <<<"$(slicc_globals "$PKG/lib/slicc/slicc_jobs.o")"; then
  echo "homescoop: slicc_jobs.o still defines tcgetpgrp or tcsetpgrp, so a program's own gets duplicate symbol (homescoop#1678)" >&2
  exit 1
fi
JOBS_MEMBERS="$WORK/wasm-emscripten-jobs"
rm -rf "$JOBS_MEMBERS"
mkdir -p "$JOBS_MEMBERS"
JOBS_REST=(__syscall_setpgid __syscall_getpgid __syscall_getsid __syscall_setsid slicc_jobs_js)
for tc in tcgetpgrp tcsetpgrp; do
  other=tcsetpgrp
  [[ "$tc" == tcsetpgrp ]] && other=tcgetpgrp
  read -ra flags <<<"$(slicc_renames "slicc_$tc" "$other" "${JOBS_REST[@]}")"
  EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" -O2 "${flags[@]}" -c "$SLICC_SHIMS/slicc_jobs.c" -o "$JOBS_MEMBERS/slicc_$tc.o"
  defs="$(slicc_globals "$JOBS_MEMBERS/slicc_$tc.o")"
  stray="$(grep -vx "$tc" <<<"$defs" | grep -v "^slicc_${tc}_" || true)"
  [[ -z "$stray" ]] || { echo "homescoop: libslicc_jobs.a's slicc_$tc.o also defines $stray, which slicc_jobs.o defines (add it to JOBS_REST)" >&2; exit 1; }
  grep -qx "$tc" <<<"$defs"
done
rm -f "$PKG/lib/slicc/libslicc_jobs.a"
(cd "$JOBS_MEMBERS" && EM_CONFIG="$HOST_EM_CONFIG" python3 "$HOST_EM/emar.py" rcsD "$PKG/lib/slicc/libslicc_jobs.a" slicc_tcgetpgrp.o slicc_tcsetpgrp.o)
test -f "$PKG/lib/slicc/libslicc_jobs.a"
echo "  lib/slicc/libslicc_signals.a, libslicc_select.a and libslicc_libc_gaps.a: one member per libc override, which calls the plain object's renamed definition"
OVR_MEMBERS="$WORK/wasm-emscripten-overrides"
rm -rf "$OVR_MEMBERS"
mkdir -p "$OVR_MEMBERS"
slicc_forwarder() {
  case "$1" in
    kill) echo 'signal.h|pid_t pid, int sig|pid, sig' ;;
    poll) echo 'poll.h|struct pollfd *fds, nfds_t n, int timeout|fds, n, timeout' ;;
    pselect) echo 'sys/select.h|int n, fd_set *rfds, fd_set *wfds, fd_set *efds, const struct timespec *ts, const sigset_t *mask|n, rfds, wfds, efds, ts, mask' ;;
    nanosleep) echo 'time.h|const struct timespec *req, struct timespec *rem|req, rem' ;;
    setuid | seteuid) echo 'unistd.h|uid_t id|id' ;;
    setgid | setegid) echo 'unistd.h|gid_t id|id' ;;
    setreuid) echo 'unistd.h|uid_t r, uid_t e|r, e' ;;
    setregid) echo 'unistd.h|gid_t r, gid_t e|r, e' ;;
    setresuid) echo 'unistd.h|uid_t r, uid_t e, uid_t s|r, e, s' ;;
    setresgid) echo 'unistd.h|gid_t r, gid_t e, gid_t s|r, e, s' ;;
    *) echo "homescoop: no forwarder signature for $1; add it to slicc_forwarder" >&2; return 1 ;;
  esac
}
for obj in "${SLICC_OVERRIDE_OBJS[@]}"; do
  read -ra overrides <<<"$(slicc_libc_overrides "$obj")"
  plain_defs="$(slicc_globals "$PKG/lib/slicc/$obj.o")"
  members=()
  for sym in "${overrides[@]}"; do
    if grep -qx "$sym" <<<"$plain_defs"; then
      echo "homescoop: lib/slicc/$obj.o still defines $sym, so a program's own $sym gets duplicate symbol (homescoop#1724)" >&2
      exit 1
    fi
    grep -qx "${obj}_$sym" <<<"$plain_defs" || { echo "homescoop: lib/slicc/$obj.o does not define ${obj}_$sym, which lib$obj.a's slicc_$sym.o calls" >&2; exit 1; }
    sig="$(slicc_forwarder "$sym")"
    IFS='|' read -r header params args <<<"$sig"
    printf '#define _GNU_SOURCE\n#include <%s>\nint %s_%s(%s);\nint %s(%s) { return %s_%s(%s); }\n' "$header" "$obj" "$sym" "$params" "$sym" "$params" "$obj" "$sym" "$args" > "$OVR_MEMBERS/slicc_$sym.c"
    EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" -O2 -Werror -c "$OVR_MEMBERS/slicc_$sym.c" -o "$OVR_MEMBERS/slicc_$sym.o"
    defs="$(slicc_globals "$OVR_MEMBERS/slicc_$sym.o")"
    [[ "$defs" == "$sym" ]] || { echo "homescoop: lib$obj.a's slicc_$sym.o defines $(tr '\n' ' ' <<<"$defs")rather than just $sym" >&2; exit 1; }
    members+=("slicc_$sym.o")
  done
  rm -f "$PKG/lib/slicc/lib$obj.a"
  (cd "$OVR_MEMBERS" && EM_CONFIG="$HOST_EM_CONFIG" python3 "$HOST_EM/emar.py" rcsD "$PKG/lib/slicc/lib$obj.a" "${members[@]}")
  test -f "$PKG/lib/slicc/lib$obj.a"
done
echo "  emcc -fPIC -c lib/slicc/linkable/*.o for -sMAIN_MODULE=1 and -sLINKABLE links, without the overrides of libc's own symbols"
mkdir -p "$PKG/lib/slicc/linkable"
for obj in slicc_spawn slicc_exec slicc_signals slicc_select slicc_libc_gaps slicc_jobs; do
  read -ra overrides <<<"$(slicc_libc_overrides "$obj")"
  read -ra flags <<<"$(slicc_renames slicc_linkable "${overrides[@]}")"
  EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" -O2 -fPIC "${flags[@]}" -c "$SLICC_SHIMS/$obj.c" -o "$PKG/lib/slicc/linkable/$obj.o"
  linkable_defs="$(slicc_globals "$PKG/lib/slicc/linkable/$obj.o")"
  link_defs="$(slicc_globals "$PKG/lib/slicc/$obj.o" "$JOBS_MEMBERS"/*.o "$OVR_MEMBERS"/*.o)"
  for sym in "${overrides[@]}"; do
    if grep -qx "$sym" <<<"$linkable_defs"; then
      echo "homescoop: lib/slicc/linkable/$obj.o defines $sym, which libc.a also defines, so -sMAIN_MODULE=1 gets duplicate symbol: $sym (homescoop#1678)" >&2
      exit 1
    fi
    grep -qx "$sym" <<<"$link_defs" || { echo "homescoop: neither lib/slicc/$obj.o nor its archive members define $sym; update slicc_libc_overrides" >&2; exit 1; }
  done
done
grep -q 'if (++cnt == SYMLOOP_MAX) {' "$HOST_EM/system/lib/libc/musl/src/misc/realpath.c"
grep -q 'if (cnt++ == SYMLOOP_MAX) {' "$PKG/system/lib/libc/musl/src/misc/realpath.c"
echo "  emcc -c slicc_realpath.o (musl realpath.c with package libc patch 0017) into lib/slicc/libslicc_realpath.a"
RP_OBJ="$WORK/wasm-emscripten-realpath/slicc_realpath.o"
rm -rf "$(dirname "$RP_OBJ")"
mkdir -p "$(dirname "$RP_OBJ")"
(cd "$PKG" && EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" -Os -fno-inline-functions -fno-builtin -std=c99 -D_XOPEN_SOURCE=700 \
  -Wno-unused-result -Wno-ignored-attributes \
  -Isystem/lib/libc/musl/arch/emscripten -Isystem/lib/libc/musl/arch/generic \
  -Isystem/lib/libc/musl/src/internal -Isystem/lib/libc/musl/src/include \
  -Isystem/lib/libc/musl/include -Isystem/lib/libc -Isystem/lib/pthread \
  -c system/lib/libc/musl/src/misc/realpath.c -o "$RP_OBJ")
test -f "$RP_OBJ"
rm -f "$PKG/lib/slicc/libslicc_realpath.a"
(cd "$(dirname "$RP_OBJ")" && EM_CONFIG="$HOST_EM_CONFIG" python3 "$HOST_EM/emar.py" rcsD "$PKG/lib/slicc/libslicc_realpath.a" slicc_realpath.o)
test -f "$PKG/lib/slicc/libslicc_realpath.a"
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
cat > "$PRE_WORK/own-rp.c" <<'C'
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
char *realpath(const char *restrict path, char *restrict resolved) {
  (void)path;
  if (resolved) return strcpy(resolved, "/own");
  return strdup("/own");
}
int main(void) {
  char *r = realpath("/no-such-path", NULL);
  printf("realpath %s\n", r ? r : "(null)");
  return 0;
}
C
cat > "$PRE_WORK/rp-caller.c" <<'C'
#include <stdio.h>
#include <stdlib.h>
int main(void) {
  char *r = realpath("/no-such-path", NULL);
  printf("realpath %s\n", r ? r : "(null)");
  return 0;
}
C
cat > "$PRE_WORK/rp-def.c" <<'C'
#include <stdlib.h>
#include <string.h>
char *realpath(const char *restrict path, char *restrict resolved) {
  (void)path;
  if (resolved) return strcpy(resolved, "/own");
  return strdup("/own");
}
C
cat > "$PRE_WORK/jobs.c" <<'C'
#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/utsname.h>
#include <unistd.h>
int main(void) {
  char buf[PATH_MAX];
  struct utsname u;
  pid_t g = tcgetpgrp(0);
  int s = tcsetpgrp(0, getpid());
  int e = s ? errno : 0;
  char *r = realpath("/tmp", buf);
  printf("hello realpath %s uname %d\n", r ? r : "(null)", uname(&u));
  printf("tcgetpgrp %s tcsetpgrp %d %s\n", g == getpid() ? "self" : g == 0 ? "0" : "other", s, e == 0 ? "ok" : e == EINVAL ? "EINVAL" : strerror(e));
  return 0;
}
C
cat > "$PRE_WORK/own-tc.c" <<'C'
#include <stdio.h>
#include <unistd.h>
int tcsetpgrp(int fd, pid_t pgrp) { (void)fd; (void)pgrp; return 7; }
int main(void) {
  printf("own tcsetpgrp %d tcgetpgrp %s\n", tcsetpgrp(0, 1), tcgetpgrp(0) == getpid() ? "self" : "other");
  return 0;
}
C
cat > "$PRE_WORK/own-libc.c" <<'C'
#define _GNU_SOURCE
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <sys/select.h>
#include <time.h>
#include <unistd.h>
#ifdef OWN_kill
int kill(pid_t pid, int sig) { (void)pid; (void)sig; return 77; }
#endif
#ifdef OWN_poll
int poll(struct pollfd *fds, nfds_t n, int timeout) { (void)fds; (void)n; (void)timeout; return 77; }
#endif
#ifdef OWN_pselect
int pselect(int n, fd_set *restrict r, fd_set *restrict w, fd_set *restrict e, const struct timespec *restrict ts, const sigset_t *restrict mask) { (void)n; (void)r; (void)w; (void)e; (void)ts; (void)mask; return 77; }
#endif
#ifdef OWN_nanosleep
int nanosleep(const struct timespec *req, struct timespec *rem) { (void)req; (void)rem; return 77; }
#endif
#ifdef OWN_setuid
int setuid(uid_t id) { (void)id; return 77; }
#endif
#ifdef OWN_setgid
int setgid(gid_t id) { (void)id; return 77; }
#endif
#ifdef OWN_seteuid
int seteuid(uid_t id) { (void)id; return 77; }
#endif
#ifdef OWN_setegid
int setegid(gid_t id) { (void)id; return 77; }
#endif
#ifdef OWN_setreuid
int setreuid(uid_t r, uid_t e) { (void)r; (void)e; return 77; }
#endif
#ifdef OWN_setregid
int setregid(gid_t r, gid_t e) { (void)r; (void)e; return 77; }
#endif
#ifdef OWN_setresuid
int setresuid(uid_t r, uid_t e, uid_t s) { (void)r; (void)e; (void)s; return 77; }
#endif
#ifdef OWN_setresgid
int setresgid(gid_t r, gid_t e, gid_t s) { (void)r; (void)e; (void)s; return 77; }
#endif
#ifndef NO_MAIN
static void row(const char *name, int r, int slicc) { printf("%s %s\n", name, r == 77 ? "own" : r == slicc ? "slicc" : "libc"); }
int main(void) {
  struct pollfd p = {0, POLLIN, 0};
  fd_set rd;
  struct timespec zero = {0, 0}, req = {0, 1000}, rem = {9, 9};
  FD_ZERO(&rd);
  FD_SET(0, &rd);
  row("kill", kill(4242, 0), 0);
  row("poll", poll(&p, 1, 0), 42);
  row("pselect", pselect(1, &rd, NULL, NULL, &zero, NULL), 42);
  int ns = nanosleep(&req, &rem);
  row("nanosleep", ns == 77 ? 77 : (int)rem.tv_sec, 0);
  row("setuid", setuid(5), 0);
  row("setgid", setgid(5), 0);
  row("seteuid", seteuid(5), 0);
  row("setegid", setegid(5), 0);
  row("setreuid", setreuid(5, 5), 0);
  row("setregid", setregid(5, 5), 0);
  row("setresuid", setresuid(5, 5, 5), 0);
  row("setresgid", setresgid(5, 5, 5), 0);
  return 0;
}
#endif
C
cat > "$PRE_WORK/priv.c" <<'C'
#define _GNU_SOURCE
#include <stdio.h>
#include <unistd.h>
int main(void) {
  uid_t r, e, s;
  printf("start %d %d %d %d\n", (int)getuid(), (int)geteuid(), (int)getgid(), (int)getegid());
  int g = setgid(5);
  printf("setgid %d getgid %d getegid %d\n", g, (int)getgid(), (int)getegid());
  int rs = setresuid(6, 0, 6);
  getresuid(&r, &e, &s);
  printf("setresuid %d getresuid %d %d %d\n", rs, (int)r, (int)e, (int)s);
  int u = setuid(5);
  getresuid(&r, &e, &s);
  printf("setuid %d getuid %d geteuid %d getresuid %d %d %d\n", u, (int)getuid(), (int)geteuid(), (int)r, (int)e, (int)s);
  return 0;
}
C
cat > "$PRE_WORK/kernel-root.js" <<'JS'
const sliccCred = { ruid: 0, euid: 0, suid: 0, rgid: 0, egid: 0, sgid: 0, groups: [] };
Module['sliccKernel'] = {
  cred: () => ({ ...sliccCred, groups: [...sliccCred.groups] }),
  setcred: (change) => { Object.assign(sliccCred, change); return 0; },
};
JS
cat > "$PRE_WORK/kernel.js" <<'JS'
Module['sliccKernel'] = {
  select: () => 42,
  kill: () => 0,
  cred: () => ({ ruid: 5, euid: 5, suid: 5, rgid: 5, egid: 5, sgid: 5, groups: [] }),
  setcred: () => 0,
};
JS
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
cp -R "$PKG"/lib/slicc/. "$NO_RP/"
rm "$NO_RP/libslicc_realpath.a"
EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$NO_RP" "${HOST_EMCC[@]}" "$PRE_WORK/symloop.c" -o "$PRE_WORK/symloop-no-rp.js"
NO_RP_OUT="$(node "$PRE_WORK/symloop-no-rp.js")"
grep -qx 'abs40 open ok stat ok realpath ELOOP' <<<"$NO_RP_OUT" || { printf '%s\n' "$NO_RP_OUT" >&2; echo "homescoop: without slicc_realpath.o the host libc should keep musl's 39-follow realpath; PRESTAGE no longer tests the override" >&2; exit 1; }
RP_EMCC=(env EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$PKG/lib/slicc" "${HOST_EMCC[@]}")
"${RP_EMCC[@]}" "$PRE_WORK/own-rp.c" -o "$PRE_WORK/own-rp.js" 2>"$PRE_WORK/own-rp.err" || { cat "$PRE_WORK/own-rp.err" >&2; echo "homescoop: a program that defines its own realpath does not link under the default link (homescoop#1664)" >&2; exit 1; }
grep -qx 'realpath /own' <<<"$(node "$PRE_WORK/own-rp.js")" || { echo "homescoop: a program that defines its own realpath runs another one under the default link (homescoop#1664)" >&2; exit 1; }
"${RP_EMCC[@]}" -c "$PRE_WORK/rp-def.c" -o "$PRE_WORK/rp-def.o"
rm -f "$PRE_WORK/librpdef.a"
(cd "$PRE_WORK" && EM_CONFIG="$HOST_EM_CONFIG" python3 "$HOST_EM/emar.py" rcs librpdef.a rp-def.o)
for mixed in "$PRE_WORK/rp-def.o" "$PRE_WORK/librpdef.a" "-L$PRE_WORK -lrpdef"; do
  read -ra mixed_args <<<"$mixed"
  "${RP_EMCC[@]}" "$PRE_WORK/rp-caller.c" "${mixed_args[@]}" -o "$PRE_WORK/rp-mixed.js" 2>"$PRE_WORK/rp-mixed.err" || { cat "$PRE_WORK/rp-mixed.err" >&2; echo "homescoop: a program whose realpath is in $mixed does not link under the default link (homescoop#1664)" >&2; exit 1; }
  grep -qx 'realpath /own' <<<"$(cd "$PRE_WORK" && node rp-mixed.js)" || { echo "homescoop: a program whose realpath is in $mixed runs another one under the default link (homescoop#1664)" >&2; exit 1; }
done
if env EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$NO_RP" "${HOST_EMCC[@]}" "$PRE_WORK/own-rp.c" "$RP_OBJ" -o "$PRE_WORK/own-rp-obj.js" 2>"$PRE_WORK/own-rp-obj.err"; then
  echo "homescoop: own-rp.c links beside slicc_realpath.o as a plain object (6.0.9-28's default link); PRESTAGE no longer tests homescoop#1664" >&2
  exit 1
fi
grep -q 'duplicate symbol: realpath' "$PRE_WORK/own-rp-obj.err"
"${RP_EMCC[@]}" "$PRE_WORK/jobs.c" -o "$PRE_WORK/jobs.js"
JOBS_OUT="$(cd "$PRE_WORK" && node jobs.js)"
printf '%s\n' "$JOBS_OUT"
grep -qx 'hello realpath /tmp uname 0' <<<"$JOBS_OUT"
grep -qx 'tcgetpgrp self tcsetpgrp 0 ok' <<<"$JOBS_OUT" || { echo "homescoop: a default-linked program does not get the slicc tcgetpgrp/tcsetpgrp from lib/slicc/libslicc_jobs.a (homescoop#1678)" >&2; exit 1; }
NO_JOBS="$PRE_WORK/libslicc-no-jobs"
mkdir -p "$NO_JOBS"
cp -R "$PKG"/lib/slicc/. "$NO_JOBS/"
rm "$NO_JOBS/libslicc_jobs.a"
env EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$NO_JOBS" "${HOST_EMCC[@]}" "$PRE_WORK/jobs.c" -o "$PRE_WORK/jobs-no-archive.js"
grep -qx 'tcgetpgrp 0 tcsetpgrp -1 EINVAL' <<<"$(cd "$PRE_WORK" && node jobs-no-archive.js)" || { echo "homescoop: without libslicc_jobs.a, libc's tcgetpgrp/tcsetpgrp should answer 0 and EINVAL; PRESTAGE no longer tests the override" >&2; exit 1; }
"${RP_EMCC[@]}" "$PRE_WORK/own-tc.c" -o "$PRE_WORK/own-tc.js" 2>"$PRE_WORK/own-tc.err" || { cat "$PRE_WORK/own-tc.err" >&2; echo "homescoop: a program that defines its own tcsetpgrp does not link under the default link (homescoop#1678)" >&2; exit 1; }
grep -qx 'own tcsetpgrp 7 tcgetpgrp self' <<<"$(cd "$PRE_WORK" && node own-tc.js)" || { echo "homescoop: a program that defines its own tcsetpgrp runs another one, or loses the slicc tcgetpgrp (homescoop#1678)" >&2; exit 1; }
OWN_SYMS=(kill poll pselect nanosleep setuid setgid seteuid setegid setreuid setregid setresuid setresgid)
own_libc_want() {
  local others=$1 s
  shift
  for s in "${OWN_SYMS[@]}"; do
    if [[ " $* " == *" $s "* ]]; then echo "$s own"; else echo "$s $others"; fi
  done
}
own_libc_run() {
  local libdir=$1 out=$2
  shift 2
  env EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$libdir" "${HOST_EMCC[@]}" --pre-js "$PRE_WORK/kernel.js" "$@" -o "$PRE_WORK/$out.js" 2>"$PRE_WORK/$out.err" || { cat "$PRE_WORK/$out.err" >&2; return 1; }
  (cd "$PRE_WORK" && node "$out.js")
}
OWN_OUT="$(own_libc_run "$PKG/lib/slicc" own-libc-none "$PRE_WORK/own-libc.c")"
printf '%s\n' "$OWN_OUT"
[[ "$OWN_OUT" == "$(own_libc_want slicc)" ]] || { echo "homescoop: a default-linked program does not get the slicc kill, poll, pselect, nanosleep and set*id from lib/slicc's override archives (homescoop#1724)" >&2; exit 1; }
for sym in "${OWN_SYMS[@]}"; do
  out="$(own_libc_run "$PKG/lib/slicc" "own-libc-$sym" "-DOWN_$sym" "$PRE_WORK/own-libc.c")" || { echo "homescoop: a program that defines its own $sym does not link under the default link (homescoop#1724)" >&2; exit 1; }
  [[ "$out" == "$(own_libc_want slicc "$sym")" ]] || { printf '%s\n' "$out" >&2; echo "homescoop: a program that defines its own $sym runs another one, or loses the slicc version of the other overrides (homescoop#1724)" >&2; exit 1; }
done
env EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" -DOWN_poll -DOWN_nanosleep -DNO_MAIN -c "$PRE_WORK/own-libc.c" -o "$PRE_WORK/own-libc-defs.o"
rm -f "$PRE_WORK/libowndefs.a"
(cd "$PRE_WORK" && EM_CONFIG="$HOST_EM_CONFIG" python3 "$HOST_EM/emar.py" rcs libowndefs.a own-libc-defs.o)
out="$(own_libc_run "$PKG/lib/slicc" own-libc-lib "$PRE_WORK/own-libc.c" "-L$PRE_WORK" -lowndefs)" || { echo "homescoop: a program whose poll and nanosleep are in its own -l archive does not link under the default link (homescoop#1724)" >&2; exit 1; }
[[ "$out" == "$(own_libc_want slicc poll nanosleep)" ]] || { printf '%s\n' "$out" >&2; echo "homescoop: a program whose poll and nanosleep are in its own -l archive runs other ones (homescoop#1724)" >&2; exit 1; }
NO_OVR="$PRE_WORK/libslicc-no-overrides"
mkdir -p "$NO_OVR"
cp -R "$PKG"/lib/slicc/. "$NO_OVR/"
for obj in "${SLICC_OVERRIDE_OBJS[@]}"; do rm "$NO_OVR/lib$obj.a"; done
out="$(own_libc_run "$NO_OVR" own-libc-no-archives "$PRE_WORK/own-libc.c")"
[[ "$out" == "$(own_libc_want libc)" ]] || { printf '%s\n' "$out" >&2; echo "homescoop: without the override archives a default link should get libc's kill, poll, pselect, nanosleep and set*id; PRESTAGE no longer tells them apart" >&2; exit 1; }
PRIV_WANT=$'start 0 0 0 0\nsetgid 0 getgid 5 getegid 5\nsetresuid 0 getresuid 6 0 6\nsetuid 0 getuid 5 geteuid 5 getresuid 5 5 5'
priv_run() {
  local libdir=$1 out=$2
  env EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$libdir" "${HOST_EMCC[@]}" --pre-js "$PRE_WORK/kernel-root.js" "$PRE_WORK/priv.c" -o "$PRE_WORK/$out.js" 2>"$PRE_WORK/$out.err" || { cat "$PRE_WORK/$out.err" >&2; return 1; }
  (cd "$PRE_WORK" && node "$out.js")
}
PRIV_OUT="$(priv_run "$PKG/lib/slicc" priv)"
printf '%s\n' "$PRIV_OUT"
[[ "$PRIV_OUT" == "$PRIV_WANT" ]] || { echo "homescoop: as root, a default-linked program's setgid(5), setresuid(6, 0, 6) and setuid(5) do not reach the kernel's credentials (getgid, getresuid, getuid and geteuid after them), so a privilege drop would be a no-op (homescoop#1724)" >&2; exit 1; }
NO_GAPS="$PRE_WORK/libslicc-no-libc-gaps-archive"
mkdir -p "$NO_GAPS"
cp -R "$PKG"/lib/slicc/. "$NO_GAPS/"
rm "$NO_GAPS/libslicc_libc_gaps.a"
PRIV_NO="$(priv_run "$NO_GAPS" priv-no-archive)"
if [[ "$PRIV_NO" == "$PRIV_WANT" ]] || ! grep -q '^setuid -1 getuid 0 geteuid 0 ' <<<"$PRIV_NO"; then
  printf '%s\n' "$PRIV_NO" >&2
  echo "homescoop: without libslicc_libc_gaps.a libc's set*id stubs should leave the credentials at root; PRESTAGE no longer tests the privilege drop" >&2
  exit 1
fi
OLD_OVR="$PRE_WORK/libslicc-6.0.9-30"
mkdir -p "$OLD_OVR"
cp -R "$NO_OVR"/. "$OLD_OVR/"
for obj in "${SLICC_OVERRIDE_OBJS[@]}"; do
  EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" -O2 -c "$SLICC_SHIMS/$obj.c" -o "$OLD_OVR/$obj.o"
done
for sym in "${OWN_SYMS[@]}"; do
  if own_libc_run "$OLD_OVR" "own-libc-old-$sym" "-DOWN_$sym" "$PRE_WORK/own-libc.c" >/dev/null 2>&1; then
    echo "homescoop: a program defining its own $sym links with 6.0.9-30's lib/slicc (plain objects that define it); PRESTAGE no longer tests homescoop#1724" >&2
    exit 1
  fi
  grep -qE "duplicate symbol: $sym\$" "$PRE_WORK/own-libc-old-$sym.err"
done
"${RP_EMCC[@]}" -sMAIN_MODULE=1 "$PRE_WORK/jobs.c" -o "$PRE_WORK/jobs-main.js" 2>"$PRE_WORK/jobs-main.err" || { cat "$PRE_WORK/jobs-main.err" >&2; echo "homescoop: -sMAIN_MODULE=1 does not link with the slicc defaults (homescoop#1678)" >&2; exit 1; }
grep -q sliccKernel "$PRE_WORK/jobs-main.js"
MAIN_OUT="$(cd "$PRE_WORK" && node jobs-main.js)"
printf '%s\n' "$MAIN_OUT"
grep -qx 'hello realpath /tmp uname 0' <<<"$MAIN_OUT" || { echo "homescoop: a -sMAIN_MODULE=1 program with the slicc defaults does not run (homescoop#1678)" >&2; exit 1; }
grep -qx 'tcgetpgrp 0 tcsetpgrp -1 EINVAL' <<<"$MAIN_OUT"
"${RP_EMCC[@]}" -sLINKABLE=1 -Wno-deprecated "$PRE_WORK/jobs.c" -o "$PRE_WORK/jobs-linkable.js" 2>"$PRE_WORK/jobs-linkable.err" || { cat "$PRE_WORK/jobs-linkable.err" >&2; echo "homescoop: -sLINKABLE=1 does not link with the slicc defaults (homescoop#1678)" >&2; exit 1; }
LINKABLE_OUT="$(cd "$PRE_WORK" && node jobs-linkable.js)"
printf '%s\n' "$LINKABLE_OUT"
grep -qx 'hello realpath /tmp uname 0' <<<"$LINKABLE_OUT" || { echo "homescoop: a -sLINKABLE=1 program with the slicc defaults does not run (homescoop#1678)" >&2; exit 1; }
grep -qx 'tcgetpgrp 0 tcsetpgrp -1 EINVAL' <<<"$LINKABLE_OUT" || { echo "homescoop: a -sLINKABLE=1 link still gets libslicc_jobs.a's tcgetpgrp/tcsetpgrp, so 0018 did not take lib/slicc/linkable and drop the archives (homescoop#1678)" >&2; exit 1; }
for mode in main linkable; do
  grep -q slicc_linkable_kill "$PRE_WORK/jobs-$mode.wasm" || { echo "homescoop: jobs-$mode.wasm does not export lib/slicc/linkable's slicc_linkable_kill, so the $mode link did not take lib/slicc/linkable (homescoop#1678)" >&2; exit 1; }
done
if grep -q slicc_linkable_kill "$PRE_WORK/jobs.wasm"; then
  echo "homescoop: the default link's jobs.wasm has slicc_linkable_kill; PRESTAGE no longer tells the linkable objects apart (homescoop#1678)" >&2
  exit 1
fi
OLD_JOBS="$PRE_WORK/libslicc-6.0.9-29"
mkdir -p "$OLD_JOBS"
cp -R "$PKG"/lib/slicc/. "$OLD_JOBS/"
rm -rf "$OLD_JOBS/linkable" "$OLD_JOBS/libslicc_jobs.a"
EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" -O2 -c "$SLICC_SHIMS/slicc_jobs.c" -o "$OLD_JOBS/slicc_jobs.o"
OLD_EMCC=(env EM_CONFIG="$HOST_EM_CONFIG" SLICC_EM_LIBDIR="$OLD_JOBS" "${HOST_EMCC[@]}")
if "${OLD_EMCC[@]}" "$PRE_WORK/own-tc.c" -o "$PRE_WORK/own-tc-old.js" 2>"$PRE_WORK/own-tc-old.err"; then
  echo "homescoop: own-tc.c links with 6.0.9-29's lib/slicc (slicc_jobs.o with tcsetpgrp); PRESTAGE no longer tests homescoop#1678" >&2
  exit 1
fi
grep -q 'duplicate symbol: tcsetpgrp' "$PRE_WORK/own-tc-old.err"
if "${OLD_EMCC[@]}" -sMAIN_MODULE=1 "$PRE_WORK/jobs.c" -o "$PRE_WORK/jobs-main-old.js" 2>"$PRE_WORK/jobs-main-old.err"; then
  echo "homescoop: -sMAIN_MODULE=1 links with 6.0.9-29's lib/slicc; PRESTAGE no longer tests homescoop#1678" >&2
  exit 1
fi
grep -q 'duplicate symbol: ' "$PRE_WORK/jobs-main-old.err"
if "${OLD_EMCC[@]}" -sLINKABLE=1 -Wno-deprecated "$PRE_WORK/jobs.c" -o "$PRE_WORK/jobs-linkable-old.js" 2>"$PRE_WORK/jobs-linkable-old.err"; then
  echo "homescoop: -sLINKABLE=1 links with 6.0.9-29's lib/slicc; PRESTAGE no longer tests homescoop#1678" >&2
  exit 1
fi
grep -q 'duplicate symbol: tcsetpgrp' "$PRE_WORK/jobs-linkable-old.err"
if EM_CONFIG="$HOST_EM_CONFIG" "${HOST_EMCC[@]}" "$PRE_WORK/hello.c" -o "$PRE_WORK/hello-cl.js" --closure=1 2>"$PRE_WORK/closure.err"; then
  echo "homescoop: --closure=1 should have failed" >&2
  exit 1
fi
grep -q "Closure Compiler is not available in SLICC's Emscripten package" "$PRE_WORK/closure.err"
CC_OUT=$(EM_CONFIG="$HOST_EM_CONFIG" python3 "$HOST_EM/emconfigure.py" sh -c 'printf %s "$CC"' 2>/dev/null || true)
echo "$CC_OUT" | grep -q 'emcc'
RO_CLEANUP
trap - EXIT
echo "  PRESTAGE: hello links with the slicc defaults, a program calling uname, link, getuid, getrlimit and raise links with -Werror and runs (#1056, #1069), under env -i a default-linked program sees no placeholder USER, LOGNAME, HOME, PATH or PWD (#1531), 40 symlink follows open, stat and realpath and 41 are ELOOP, absolute and relative, and without libslicc_realpath.a realpath is ELOOP at 40 (#611, #1631), a program's own realpath (in its own source, a later object, an archive or -l) links and runs, not the archive's, and 6.0.9-28's plain slicc_realpath.o gives duplicate symbol: realpath (#1664), a default link gets the slicc tcgetpgrp/tcsetpgrp from libslicc_jobs.a and a program's own tcsetpgrp wins, -sMAIN_MODULE=1 and -sLINKABLE=1 links with the slicc defaults take lib/slicc/linkable (slicc_linkable_kill exported, libc's tcgetpgrp/tcsetpgrp, which the default link does not have) and run, and 6.0.9-29's lib/slicc gives duplicate symbol: tcsetpgrp and fails -sMAIN_MODULE=1 and -sLINKABLE=1 (#1678), a default link gets the slicc kill, poll, pselect, nanosleep and 8 set*id from libslicc_signals.a, libslicc_select.a and libslicc_libc_gaps.a (libc's without them), a program's own definition of each of the 12 (in its source, or poll and nanosleep in its own -l archive) links and runs its own while the other 11 stay slicc's, and 6.0.9-30's plain objects give duplicate symbol for each, and as root setgid(5), setresuid(6, 0, 6) and setuid(5) change what getgid, getresuid, getuid and geteuid report, which libc's stubs (without libslicc_libc_gaps.a) do not (#1724), --closure is refused, emconfigure sets CC"


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
test -f "$PKG/lib/slicc/libslicc_realpath.a"
test ! -e "$PKG/lib/slicc/slicc_realpath.o"
test -f "$PKG/lib/slicc/libslicc_jobs.a"
for obj in "${SLICC_OVERRIDE_OBJS[@]}"; do
  test -f "$PKG/lib/slicc/lib$obj.a"
done
for obj in slicc_spawn slicc_exec slicc_signals slicc_select slicc_libc_gaps slicc_jobs; do
  test -f "$PKG/lib/slicc/linkable/$obj.o"
done
grep -q "for lib in ('libslicc_signals.a', 'libslicc_select.a', 'libslicc_libc_gaps.a', 'libslicc_jobs.a', 'libslicc_realpath.a'):" "$PKG/tools/link.py"
grep -q "linkable = settings.MAIN_MODULE == 1 or settings.LINKABLE" "$PKG/tools/link.py"
! grep -q "'slicc_realpath.o'," "$PKG/tools/link.py"
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
grep -q '"@ai-ecoverse/emscripten-cache": "6.0.9-7"' "$PKG/package.json"
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
