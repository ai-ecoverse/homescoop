#!/usr/bin/env bash
# wasix-sysroot 2025.9.30-21 on any host (CI): the published -14 package,
# byte for byte, plus slicc_stat_owner.o in every libc.a (replacing fstat.o
# and fstatat.o; -15, d292a32) and slicc_fs file modes (-16/-17, homescoop#169):
# patches/posix.c and patches/at_fdcwd.c replace posix.o and at_fdcwd.o.
# The full rebuild in
# build.sh (stage ~/.wasixcc, rebuild the libc++ runtimes) stays local:
# HOMESCOOP_WASIX_SYSROOT_FULL=1.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
VARIANTS=(sysroot sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic)
PIC_VARIANTS=" sysroot-ehpic sysroot-exnref-ehpic "

# recipe.yaml source: the published -14 tarball, sha256-pinned.
homescoop_load_recipe wasix-sysroot
BASE_TGZ="$WORK/$(basename "$SRC_URL")"
BASE_VER="$(basename "$SRC_URL" .tgz)"
BASE_VER="${BASE_VER#wasix-sysroot-}"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$BASE_TGZ"

# Pinned WASIX toolchain (clang 21 + llvm-ar), in WORK so a developer's
# ~/.wasixcc is neither used nor touched.
PKG="$HOMESCOOP_PKG/package"
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$WORK/wasixcc")"
CLANG="$WASIXCC_LLVM_LOCATION/bin/clang"
LLVM_AR="$WASIXCC_LLVM_LOCATION/bin/llvm-ar"
RES="$("$CLANG" -print-resource-dir)"
test -x "$CLANG" && test -x "$LLVM_AR" && test -d "$RES"

echo "== wasix-sysroot: base @ai-ecoverse/wasix-sysroot@$BASE_VER"
BASE="$WORK/wasix-sysroot-base"
rm -rf "$BASE" && mkdir -p "$BASE"
tar xzf "$BASE_TGZ" -C "$BASE" --no-same-owner
for v in "${VARIANTS[@]}"; do
  test -f "$BASE/package/$v/lib/wasm32-wasip1/libc.a"
  rm -rf "${PKG:?}/$v"
  cp -R "$BASE/package/$v" "$PKG/$v"
done

echo "== wasix-sysroot: compile slicc_stat_owner.c"
STAT_SRC="$HOMESCOOP_PKG/slicc_stat_owner.c"
OBJ="$WORK/stat-owner"
rm -rf "$OBJ" && mkdir -p "$OBJ/static" "$OBJ/pic"
compile_stat() {
  local out=$1; shift
  "$CLANG" --target=wasm32-wasip1 --sysroot="$PKG/sysroot" -resource-dir="$RES" \
    -I"$PKG/sysroot/include" \
    -matomics -mbulk-memory -mmutable-globals -pthread \
    -fno-trapping-math -ftls-model=local-exec \
    -msimd128 -mrelaxed-simd -mextended-const -O2 \
    "$@" -c "$STAT_SRC" -o "$out"
  test -s "$out"
}
# The archive member must be named slicc_stat_owner.o in both flavours.
compile_stat "$OBJ/static/slicc_stat_owner.o"
compile_stat "$OBJ/pic/slicc_stat_owner.o" -fPIC -fvisibility=default

echo "== wasix-sysroot: inject slicc_stat_owner.o into every libc.a"
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  # List first: grep -q closing the pipe early would fail llvm-ar (pipefail).
  before="$("$LLVM_AR" t "$lib")"
  grep -qx fstat.o <<<"$before" || { echo "homescoop: $lib has no fstat.o (not -14?)" >&2; exit 1; }
  "$LLVM_AR" d "$lib" fstat.o fstatat.o
  "$LLVM_AR" r "$lib" "$OBJ/$flavour/slicc_stat_owner.o"
  members="$("$LLVM_AR" t "$lib")"
  grep -qx slicc_stat_owner.o <<<"$members"
  if grep -qxE 'fstat\.o|fstatat\.o' <<<"$members"; then
    echo "homescoop: $lib still has fstat.o/fstatat.o" >&2
    exit 1
  fi
  echo "  $v ($flavour)"
done

# -16: file modes through the kernel's slicc_fs imports (slicc-kernel#197).
# Upstream v2025-09-02.1 sources with chmod/fchmod/fchmodat/umask and
# create modes added; see patches/README.md. Same target features as the
# shipped posix.o (no simd), so the objects stay link-compatible.
echo "== wasix-sysroot: compile slicc_fs posix.c / at_fdcwd.c"
FS_OBJ="$WORK/slicc-fs"
rm -rf "$FS_OBJ" && mkdir -p "$FS_OBJ/static" "$FS_OBJ/pic"
compile_fs() {
  local src=$1 out=$2; shift 2
  "$CLANG" --target=wasm32-wasip1 --sysroot="$PKG/sysroot" -resource-dir="$RES" \
    -I"$PKG/sysroot/include" \
    -matomics -mbulk-memory -mmutable-globals -pthread \
    -fno-trapping-math -ftls-model=local-exec -O2 \
    "$@" -c "$HOMESCOOP_PKG/patches/$src.c" -o "$out"
  test -s "$out"
}
for src in posix at_fdcwd; do
  compile_fs "$src" "$FS_OBJ/static/$src.o"
  compile_fs "$src" "$FS_OBJ/pic/$src.o" -fPIC -fvisibility=default
done
LLVM_NM="$WASIXCC_LLVM_LOCATION/bin/llvm-nm"
defined() { "$LLVM_NM" --defined-only -j "$1" | sort -u; }

echo "== wasix-sysroot: replace posix.o and at_fdcwd.o in every libc.a"
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$WORK/slicc-fs/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" posix.o at_fdcwd.o)
  for src in posix at_fdcwd; do
    # The patched file must define everything the shipped object did: a
    # mismatch means the base libc is not v2025-09-02.1.
    missing="$(comm -23 <(defined "$old/$src.o") <(defined "$FS_OBJ/$flavour/$src.o"))"
    if [[ -n "$missing" ]]; then
      echo "homescoop: $v $src.o: patched source lacks: $missing" >&2
      exit 1
    fi
  done
  "$LLVM_AR" r "$lib" "$FS_OBJ/$flavour/posix.o" "$FS_OBJ/$flavour/at_fdcwd.o"
  undef="$("$LLVM_NM" -u "$lib" 2>/dev/null)"
  grep -q __slicc_fs_fd_chmod <<<"$undef" || { echo "homescoop: $lib lacks slicc_fs imports" >&2; exit 1; }
  echo "  $v ($flavour)"
done

# -18: select/pselect accept exceptfds (homescoop#195), chdir keeps
# the physical cwd (#196), musl's TZ handling (POSIX rules, TZif files;
# #193), and socketpair() honours SOCK_NONBLOCK/SOCK_CLOEXEC (upstream
# 2025b44a5d); sigaction reports dispositions to the kernel through
# slicc.sigaction_set (ENOSYS on older kernels, ignored). See patches/README.md.
echo "== wasix-sysroot: -18 members (pselect, chdir, __tz, socketpair, sigaction)"
homescoop_load_recipe wasix-sysroot --source wasix_libc
LIBC_TGZ="$WORK/$(basename "$WASIX_LIBC_SRC_URL")"
homescoop_fetch "$WASIX_LIBC_SRC_URL" "$WASIX_LIBC_SRC_SHA" "$LIBC_TGZ"
LIBC_SRC="$WORK/wasix-libc-src"
rm -rf "$LIBC_SRC" && mkdir -p "$LIBC_SRC"
tar xzf "$LIBC_TGZ" -C "$LIBC_SRC" --strip-components=1
MUSL="$LIBC_SRC/libc-top-half/musl"
R18_OBJ="$WORK/r18"
rm -rf "$R18_OBJ" && mkdir -p "$R18_OBJ/static" "$R18_OBJ/pic"
compile_r18() {
  local src=$1 out=$2; shift 2
  "$CLANG" --target=wasm32-wasip1 --sysroot="$PKG/sysroot" -resource-dir="$RES" \
    -isystem "$PKG/sysroot/include" \
    -matomics -mbulk-memory -mmutable-globals -pthread \
    -fno-trapping-math -ftls-model=local-exec -O2 -Wno-parentheses \
    "$@" -c "$HOMESCOOP_PKG/patches/$src.c" -o "$out"
  test -s "$out"
}
MUSL_INC=(-I"$MUSL/src/time" -I"$MUSL/src/include" -I"$MUSL/src/internal" -I"$MUSL/arch/wasm32" -I"$MUSL/arch/generic" -I"$LIBC_SRC/libc-top-half/headers/private")
for flavour in static pic; do
  extra=()
  [[ $flavour == pic ]] && extra=(-fPIC -fvisibility=default)
  for src in pselect chdir socketpair; do
    compile_r18 "$src" "$R18_OBJ/$flavour/$src.o" "${extra[@]}"
  done
  compile_r18 __tz "$R18_OBJ/$flavour/__tz.o" "${MUSL_INC[@]}" "${extra[@]}"
  compile_r18 sigaction "$R18_OBJ/$flavour/sigaction.o" "${MUSL_INC[@]}" "${extra[@]}"
done
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R18_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" pselect.o chdir.o __tz.o socketpair.o sigaction.o)
  for m in pselect chdir __tz socketpair sigaction; do
    missing="$(comm -23 <(defined "$old/$m.o") <(defined "$R18_OBJ/$flavour/$m.o"))"
    if [[ -n "$missing" ]]; then
      echo "homescoop: $v $m.o: patched source lacks: $missing" >&2
      exit 1
    fi
  done
  "$LLVM_AR" r "$lib" "$R18_OBJ/$flavour/pselect.o" "$R18_OBJ/$flavour/chdir.o" "$R18_OBJ/$flavour/__tz.o" "$R18_OBJ/$flavour/socketpair.o" "$R18_OBJ/$flavour/sigaction.o"
  grep -q __slicc_sigaction_set <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc.sigaction_set" >&2; exit 1; }
  echo "  $v ($flavour)"
done

# -19: signals and timers, the same in every variant (sysroot-ehpic and
# sysroot-exnref-ehpic had wasix-python's setitimer/EINTR patches, the others
# upstream's): setitimer/alarm take it_value through proc_raise_interval2
# (ITIMER_REAL only; getitimer and `old` report it), clock_nanosleep returns
# EINTR with the time left and sleep() the seconds left, raise() signals the
# process (slicc-kernel does not deliver thread_signal; slicc-kernel#250), and
# so does pthread_kill() to the main thread (placeholder tid).
# See patches/README.md.
echo "== wasix-sysroot: -19 members (setitimer, getitimer, clock_nanosleep, sleep, raise, pthread_kill)"
R19_OBJ="$WORK/r19"
rm -rf "$R19_OBJ" && mkdir -p "$R19_OBJ/static" "$R19_OBJ/pic"
BOTTOM_INC=(-I"$LIBC_SRC/libc-bottom-half/headers/private" -I"$LIBC_SRC/libc-bottom-half/cloudlibc/src/include" -I"$LIBC_SRC/libc-bottom-half/cloudlibc/src" -I"$MUSL/src/include" -I"$MUSL/src/internal")
R19=(setitimer getitimer clock_nanosleep sleep raise pthread_kill)
for flavour in static pic; do
  extra=()
  [[ $flavour == pic ]] && extra=(-fPIC -fvisibility=default)
  compile_r18 setitimer "$R19_OBJ/$flavour/setitimer.o" "${MUSL_INC[@]}" "${extra[@]}"
  compile_r18 getitimer "$R19_OBJ/$flavour/getitimer.o" "${MUSL_INC[@]}" "${extra[@]}"
  compile_r18 raise "$R19_OBJ/$flavour/raise.o" "${MUSL_INC[@]}" "${extra[@]}"
  compile_r18 pthread_kill "$R19_OBJ/$flavour/pthread_kill.o" "${MUSL_INC[@]}" "${extra[@]}"
  compile_r18 clock_nanosleep "$R19_OBJ/$flavour/clock_nanosleep.o" "${BOTTOM_INC[@]}" "${extra[@]}"
  compile_r18 sleep "$R19_OBJ/$flavour/sleep.o" "${BOTTOM_INC[@]}" "${extra[@]}"
done
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R19_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" setitimer.o getitimer.o clock_nanosleep.o sleep.o raise.o pthread_kill.o)
  for m in "${R19[@]}"; do
    missing="$(comm -23 <(defined "$old/$m.o") <(defined "$R19_OBJ/$flavour/$m.o"))"
    if [[ -n "$missing" ]]; then
      echo "homescoop: $v $m.o: patched source lacks: $missing" >&2
      exit 1
    fi
  done
  "$LLVM_AR" r "$lib" $(printf "$R19_OBJ/$flavour/%s.o " "${R19[@]}")
  undef="$("$LLVM_NM" -u "$lib" 2>/dev/null)"
  grep -q __homescoop_proc_raise_interval2 <<<"$undef" || { echo "homescoop: $lib setitimer lacks proc_raise_interval2" >&2; exit 1; }
  # -17's sysroot-ehpic shipped the archives its libc patches replaced.
  rm -f "$PKG/$v/lib/wasm32-wasip1/"libc.a.bak-*
  echo "  $v ($flavour)"
done

# -20 (homescoop#207, needs slicc-kernel K1): user and group ids from the
# kernel (slicc_identity.c over slicc.cred_get/cred_set/groups_get/
# groups_set) instead of 1000; musl's own getpw*/getgr* read the kernel's
# /etc/passwd and /etc/group; the cloudlibc set*id no-ops and the ENOTSUP
# setgroups go. unistd.h declares the calls wasi-libc hid.
echo "== wasix-sysroot: -20 members (slicc_identity, musl passwd)"
R20_OBJ="$WORK/r20"
rm -rf "$R20_OBJ" && mkdir -p "$R20_OBJ/static" "$R20_OBJ/pic"
PASSWD=(getpwent getpw_r getgrent getgr_r)
R20_DROP=(setuid.o seteuid.o setgid.o setegid.o setgroups.o)
exported() { "$LLVM_NM" --defined-only --extern-only -j "$1" | sort -u; }
compile_r20() {
  local src=$1 out=$2; shift 2
  "$CLANG" --target=wasm32-wasip1 --sysroot="$PKG/sysroot" -resource-dir="$RES" \
    -isystem "$PKG/sysroot/include" \
    -matomics -mbulk-memory -mmutable-globals -pthread \
    -fno-trapping-math -ftls-model=local-exec -O2 -Wno-parentheses \
    "$@" -c "$src" -o "$out"
  test -s "$out"
}
for flavour in static pic; do
  extra=()
  [[ $flavour == pic ]] && extra=(-fPIC -fvisibility=default)
  compile_r20 "$HOMESCOOP_PKG/slicc_identity.c" "$R20_OBJ/$flavour/slicc_identity.o" "${extra[@]}"
  for m in "${PASSWD[@]}"; do
    compile_r20 "$MUSL/src/passwd/$m.c" "$R20_OBJ/$flavour/$m.o" "${MUSL_INC[@]}" "${extra[@]}"
  done
done
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R20_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" slicc_identity.o "${R20_DROP[@]}")
  # Every global the replaced members defined is still defined.
  missing="$(comm -23 <(for o in "$old"/*.o; do exported "$o"; done | sort -u) <(for m in slicc_identity "${PASSWD[@]}"; do exported "$R20_OBJ/$flavour/$m.o"; done | sort -u))"
  if [[ -n "$missing" ]]; then
    echo "homescoop: $v -20 members lack: $missing" >&2
    exit 1
  fi
  "$LLVM_AR" d "$lib" "${R20_DROP[@]}"
  "$LLVM_AR" r "$lib" "$R20_OBJ/$flavour/slicc_identity.o" $(printf "$R20_OBJ/$flavour/%s.o " "${PASSWD[@]}")
  "$LLVM_AR" t "$lib" | grep -qx getpw_r.o
  grep -q __slicc_cred_get <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc.cred_get" >&2; exit 1; }
  echo "  $v ($flavour)"
done
for v in "${VARIANTS[@]}"; do
  python3 - "$PKG/$v/include/unistd.h" <<'PYHDR'
import sys
from pathlib import Path
p = Path(sys.argv[1]); t = p.read_text()
guards = [
    ("#ifdef __wasilibc_unmodified_upstream /* WASI has no getuid etc. */\nint getgroups(int, gid_t []);\n#endif\n",
     "int getgroups(int, gid_t []); /* homescoop wasix-sysroot -20 */\n"),
    ("#ifdef __wasilibc_unmodified_upstream /* WASI has no setreuid */\nint setreuid(uid_t, uid_t);\nint setregid(gid_t, gid_t);\n#endif\n",
     "int setreuid(uid_t, uid_t); /* homescoop wasix-sysroot -20 */\nint setregid(gid_t, gid_t);\n"),
    ("#ifdef __wasilibc_unmodified_upstream /* WASI has no get/setresuid */\nint setresuid(uid_t, uid_t, uid_t);\nint setresgid(gid_t, gid_t, gid_t);\nint getresuid(uid_t *, uid_t *, uid_t *);\nint getresgid(gid_t *, gid_t *, gid_t *);\n#endif\n",
     "int setresuid(uid_t, uid_t, uid_t); /* homescoop wasix-sysroot -20 */\nint setresgid(gid_t, gid_t, gid_t);\nint getresuid(uid_t *, uid_t *, uid_t *);\nint getresgid(gid_t *, gid_t *, gid_t *);\n"),
]
for old, new in guards:
    if new in t:
        continue
    if t.count(old) != 1:
        sys.exit(f"{p}: guard not found: {old.splitlines()[0]}")
    t = t.replace(old, new)
p.write_text(t)
PYHDR
done

# -21: terminals per descriptor through slicc-kernel's slicc_tty module
# (slicc-kernel#289; homescoop #247 raw mode, #279 TIOCGWINSZ on pipes):
# tcgetattr/tcsetattr carry the whole termios, ioctl TCGETS/TCSETS*/
# TIOCGWINSZ and isatty answer per fd, tcflush/tcdrain check the fd. ENOSYS
# (older kernels) keeps the tty_get/tty_set path. See patches/README.md.
echo "== wasix-sysroot: -21 members (tcgetattr, tcsetattr, tcflush, tcdrain, ioctl, isatty)"
R21_OBJ="$WORK/r21"
rm -rf "$R21_OBJ" && mkdir -p "$R21_OBJ/static" "$R21_OBJ/pic"
R21_TOP=(tcgetattr tcsetattr tcflush tcdrain)
R21_BOTTOM=(ioctl isatty)
for flavour in static pic; do
  extra=()
  [[ $flavour == pic ]] && extra=(-fPIC -fvisibility=default)
  for m in "${R21_TOP[@]}"; do compile_r18 "$m" "$R21_OBJ/$flavour/$m.o" "${MUSL_INC[@]}" "${extra[@]}"; done
  for m in "${R21_BOTTOM[@]}"; do compile_r18 "$m" "$R21_OBJ/$flavour/$m.o" "${BOTTOM_INC[@]}" "${extra[@]}"; done
done
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R21_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" tcgetattr.o tcsetattr.o tcflush.o tcdrain.o ioctl.o isatty.o)
  for m in "${R21_TOP[@]}" "${R21_BOTTOM[@]}"; do
    missing="$(comm -23 <(defined "$old/$m.o") <(defined "$R21_OBJ/$flavour/$m.o"))"
    if [[ -n "$missing" ]]; then
      echo "homescoop: $v $m.o: patched source lacks: $missing" >&2
      exit 1
    fi
  done
  "$LLVM_AR" r "$lib" $(printf "$R21_OBJ/$flavour/%s.o " "${R21_TOP[@]}" "${R21_BOTTOM[@]}")
  grep -q __slicc_tty_winsize <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc_tty imports" >&2; exit 1; }
  echo "  $v ($flavour)"
done

homescoop_assert_no_package_links "$PKG"
echo "== wasix-sysroot: staged $(node -p "require('$PKG/package.json').version") from $BASE_VER"
