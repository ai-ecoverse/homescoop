#!/usr/bin/env bash
# wasix-sysroot 2025.9.30-30 on any host (CI): the published -14 package,
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
# See patches/README.md. Since -22, getitimer() is in setitimer.c (its helper
# is static: a dynamic-main exports hidden symbols too) and getitimer.o goes.
echo "== wasix-sysroot: -19 members (setitimer+getitimer, clock_nanosleep, sleep, raise, pthread_kill)"
R19_OBJ="$WORK/r19"
rm -rf "$R19_OBJ" && mkdir -p "$R19_OBJ/static" "$R19_OBJ/pic"
BOTTOM_INC=(-I"$LIBC_SRC/libc-bottom-half/headers/private" -I"$LIBC_SRC/libc-bottom-half/cloudlibc/src/include" -I"$LIBC_SRC/libc-bottom-half/cloudlibc/src" -I"$MUSL/src/include" -I"$MUSL/src/internal")
R19=(setitimer clock_nanosleep sleep raise pthread_kill)
for flavour in static pic; do
  extra=()
  [[ $flavour == pic ]] && extra=(-fPIC -fvisibility=default)
  compile_r18 setitimer "$R19_OBJ/$flavour/setitimer.o" "${MUSL_INC[@]}" "${extra[@]}"
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
  missing="$(comm -23 <(defined "$old/getitimer.o") <(defined "$R19_OBJ/$flavour/setitimer.o"))"
  [[ -z "$missing" ]] || { echo "homescoop: $v setitimer.o lacks getitimer.o's $missing" >&2; exit 1; }
  "$LLVM_AR" d "$lib" getitimer.o
  "$LLVM_AR" r "$lib" $(printf "$R19_OBJ/$flavour/%s.o " "${R19[@]}")
  if "$LLVM_NM" -j "$lib" 2>/dev/null | grep -qx __homescoop_itimer_real_left; then
    echo "homescoop: $lib still has __homescoop_itimer_real_left" >&2; exit 1
  fi
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
echo "== wasix-sysroot: -21 members (tcgetattr, tcsetattr, tcflush, tcdrain, ioctl, isatty; -23 ioctl: Linux TIOCGWINSZ/TIOCSWINSZ)"
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

# -22: a libc generation marker in every program. crt1*.o get a wasm custom
# section `slicc.libc` = "wasix-sysroot <version>" (wasm-ld -r): every
# program links a crt1, wasm-ld copies custom sections, and wasm-opt
# (-O*, --strip-debug/--strip-producers/--strip, --asyncify) and llvm-strip
# keep it. slicc-kernel reads it to tell libc generations apart (-18's
# clock_nanosleep wants ENOTSUP where -19+ want EINTR). Side modules have no
# crt1 and no marker; the main program's counts. See patches/README.md.
VER="$(node -p "require('$PKG/package.json').version")"
echo "== wasix-sysroot: -22 slicc.libc marker \"wasix-sysroot $VER\" in every crt1*.o"
WASM_LD="$WASIXCC_LLVM_LOCATION/bin/wasm-ld"
MARK="$WORK/r22"
rm -rf "$MARK" && mkdir -p "$MARK"
printf '__asm__(".section .custom_section.slicc.libc,\\"\\",@\\n.ascii \\"wasix-sysroot %s\\"\\n.text\\n");\n' "$VER" > "$MARK/marker.c"
"$CLANG" --target=wasm32-wasip1 -c "$MARK/marker.c" -o "$MARK/marker.o"
n=0
for v in "${VARIANTS[@]}"; do
  for crt in "$PKG/$v/lib/wasm32-wasip1/"crt1*.o; do
    "$WASM_LD" -r "$crt" "$MARK/marker.o" -o "$crt.marked"
    mv "$crt.marked" "$crt"
    grep -aq "wasix-sysroot $VER" "$crt" || { echo "homescoop: $crt lacks the slicc.libc marker" >&2; exit 1; }
    n=$((n + 1))
  done
done
[[ $n -eq 15 ]] || { echo "homescoop: marked $n crt1*.o, expected 15 (5 variants x 3)" >&2; exit 1; }
echo "  $n crt1*.o"

echo "== wasix-sysroot: -23 members (fork, _Fork in the PIC variants)"
R23_OBJ="$WORK/r23"
rm -rf "$R23_OBJ" && mkdir -p "$R23_OBJ"
R23=(fork _Fork)
for m in "${R23[@]}"; do
  compile_r20 "$MUSL/src/process/$m.c" "$R23_OBJ/$m.o" "${MUSL_INC[@]}" -fPIC -fvisibility=default
done
for v in $PIC_VARIANTS; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  old="$R23_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" fork.o _Fork.o)
  stubs="$(for m in "${R23[@]}"; do exported "$old/$m.o" 2>/dev/null; done)"
  if grep -qxE 'fork|_Fork|_fork_internal' <<<"$stubs"; then
    echo "homescoop: $v fork.o/_Fork.o are no longer upstream's empty EH stubs" >&2
    exit 1
  fi
  for m in "${R23[@]}"; do
    missing="$(comm -23 <(exported "$old/$m.o" 2>/dev/null) <(exported "$R23_OBJ/$m.o"))"
    [[ -z "$missing" ]] || { echo "homescoop: $v $m.o: the PIC build lacks: $missing" >&2; exit 1; }
  done
  "$LLVM_AR" r "$lib" $(printf "$R23_OBJ/%s.o " "${R23[@]}")
  have="$(exported "$lib" 2>/dev/null)"
  for s in fork _Fork _fork_internal; do
    grep -qx "$s" <<<"$have" || { echo "homescoop: $lib lacks $s" >&2; exit 1; }
  done
  echo "  $v (pic)"
done

echo "== wasix-sysroot: -24 members (chown, fchown, lchown, fchownat through slicc_fs)"
R24_OBJ="$WORK/r24"
rm -rf "$R24_OBJ" && mkdir -p "$R24_OBJ/static" "$R24_OBJ/pic"
R24_DROP=(chown.o fchown.o lchown.o fchownat.o)
compile_r18 chown "$R24_OBJ/static/slicc_chown.o"
compile_r18 chown "$R24_OBJ/pic/slicc_chown.o" -fPIC -fvisibility=default
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R24_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" "${R24_DROP[@]}")
  missing="$(comm -23 <(for o in "$old"/*.o; do exported "$o"; done | sort -u) <(exported "$R24_OBJ/$flavour/slicc_chown.o"))"
  [[ -z "$missing" ]] || { echo "homescoop: $v slicc_chown.o lacks: $missing" >&2; exit 1; }
  "$LLVM_AR" d "$lib" "${R24_DROP[@]}"
  "$LLVM_AR" r "$lib" "$R24_OBJ/$flavour/slicc_chown.o"
  members="$("$LLVM_AR" t "$lib")"
  if grep -qxE 'chown\.o|fchown\.o|lchown\.o|fchownat\.o' <<<"$members"; then
    echo "homescoop: $lib still has upstream chown members" >&2; exit 1
  fi
  undef="$("$LLVM_NM" -u "$lib" 2>/dev/null)"
  for s in __slicc_fs_path_chown __slicc_fs_fd_chown __slicc_fs_path_owner __slicc_fs_fd_owner __slicc_fs_path_filestat_owner __slicc_fs_fd_filestat_owner; do
    grep -q "$s" <<<"$undef" || { echo "homescoop: $lib lacks slicc_fs $s" >&2; exit 1; }
  done
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: -25 members (faccessat/eaccess through slicc_fs.path_access; AT_EACCESS 0x200)"
for v in "${VARIANTS[@]}"; do
  python3 - "$PKG/$v/include" <<'PYHDR'
import sys
from pathlib import Path
inc = Path(sys.argv[1])
edits = [
    (inc / "__header_fcntl.h", "#define AT_EACCESS          (0x0)\n", "#define AT_EACCESS          (0x200)\n"),
    (inc / "unistd.h", "#ifdef __wasilibc_unmodified_upstream /* WASI has no eaccess */\nint euidaccess(const char *, int);\nint eaccess(const char *, int);\n",
     "int euidaccess(const char *, int);\nint eaccess(const char *, int);\n#ifdef __wasilibc_unmodified_upstream /* WASI has no copy_file_range, gettid */\n"),
]
for path, old, new in edits:
    t = path.read_text()
    if new in t:
        continue
    if t.count(old) != 1:
        sys.exit(f"{path}: not found: {old.splitlines()[0]}")
    path.write_text(t.replace(old, new))
PYHDR
done
R25_OBJ="$WORK/r25"
rm -rf "$R25_OBJ" && mkdir -p "$R25_OBJ/static" "$R25_OBJ/pic"
compile_r18 faccessat "$R25_OBJ/static/faccessat.o"
compile_r18 faccessat "$R25_OBJ/pic/faccessat.o" -fPIC -fvisibility=default
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R25_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" faccessat.o)
  missing="$(comm -23 <(defined "$old/faccessat.o") <(defined "$R25_OBJ/$flavour/faccessat.o"))"
  [[ -z "$missing" ]] || { echo "homescoop: $v faccessat.o: patched source lacks: $missing" >&2; exit 1; }
  "$LLVM_AR" r "$lib" "$R25_OBJ/$flavour/faccessat.o"
  have="$(exported "$lib" 2>/dev/null)"
  for s in eaccess euidaccess __wasilibc_nocwd_faccessat; do
    grep -qx "$s" <<<"$have" || { echo "homescoop: $lib lacks $s" >&2; exit 1; }
  done
  grep -q __slicc_fs_path_access <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc_fs.path_access" >&2; exit 1; }
  grep -q "AT_EACCESS          (0x200)" "$PKG/$v/include/__header_fcntl.h"
  grep -q "WASI has no copy_file_range, gettid" "$PKG/$v/include/unistd.h"
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: -27 members (utimensat/futimens, clock/times/getrusage, emulated __clock)"
R27_OBJ="$WORK/r27"
rm -rf "$R27_OBJ" && mkdir -p "$R27_OBJ/static" "$R27_OBJ/pic"
for flavour in static pic; do
  extra=()
  [[ $flavour == pic ]] && extra=(-fPIC -fvisibility=default)
  for m in utimens cputime emulated_clock; do compile_r18 "$m" "$R27_OBJ/$flavour/$m.o" "${extra[@]}"; done
done
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  emu="$PKG/$v/lib/wasm32-wasip1/libwasi-emulated-process-clocks.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R27_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old/emu"
  (cd "$old" && "$LLVM_AR" x "$lib" utimensat.o futimens.o clock.o times.o getrusage.o)
  (cd "$old/emu" && "$LLVM_AR" x "$emu" clock.o)
  missing="$(comm -23 <(for o in "$old"/*.o; do exported "$o"; done | sort -u) <(for m in utimens cputime; do exported "$R27_OBJ/$flavour/$m.o"; done | sort -u))"
  [[ -z "$missing" ]] || { echo "homescoop: $v -27 members lack: $missing" >&2; exit 1; }
  missing="$(comm -23 <(exported "$old/emu/clock.o") <(exported "$R27_OBJ/$flavour/emulated_clock.o"))"
  [[ -z "$missing" ]] || { echo "homescoop: $v emulated clock.o lacks: $missing" >&2; exit 1; }
  "$LLVM_AR" d "$lib" utimensat.o futimens.o clock.o times.o getrusage.o
  "$LLVM_AR" r "$lib" "$R27_OBJ/$flavour/utimens.o" "$R27_OBJ/$flavour/cputime.o"
  cp "$R27_OBJ/$flavour/emulated_clock.o" "$old/emu/clock.o"
  "$LLVM_AR" r "$emu" "$old/emu/clock.o"
  members="$("$LLVM_AR" t "$lib")"
  if grep -qxE 'utimensat\.o|futimens\.o|clock\.o|times\.o|getrusage\.o' <<<"$members"; then
    echo "homescoop: $lib still has the upstream time members" >&2; exit 1
  fi
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: -28 members (pthread_sigmask, sigpending, sigsuspend, sigtimedwait, sigwaitinfo, sigwait, ppoll; slicc.sigmask_set / sigpending_get / sigmask_poll)"
R28_OBJ="$WORK/r28"
R28_DROP=(pthread_sigmask.o sigpending.o sigsuspend.o sigtimedwait.o sigwaitinfo.o sigwait.o)
rm -rf "$R28_OBJ" && mkdir -p "$R28_OBJ/static" "$R28_OBJ/pic"
compile_r18 sigmask "$R28_OBJ/static/sigmask.o"
compile_r18 sigmask "$R28_OBJ/pic/sigmask.o" -fPIC -fvisibility=default
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R28_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" "${R28_DROP[@]}")
  missing="$(comm -23 <(for o in "$old"/*.o; do exported "$o"; done | sort -u) <(exported "$R28_OBJ/$flavour/sigmask.o"))"
  [[ -z "$missing" ]] || { echo "homescoop: $v sigmask.o lacks: $missing" >&2; exit 1; }
  "$LLVM_AR" d "$lib" "${R28_DROP[@]}"
  "$LLVM_AR" r "$lib" "$R28_OBJ/$flavour/sigmask.o"
  if grep -qxE 'pthread_sigmask\.o|sigpending\.o|sigsuspend\.o|sigtimedwait\.o|sigwaitinfo\.o|sigwait\.o' <<<"$("$LLVM_AR" t "$lib")"; then
    echo "homescoop: $lib still has the upstream signal-mask members" >&2; exit 1
  fi
  for imp in __slicc_sigmask_set __slicc_sigmask_poll; do
    grep -q "$imp" <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks $imp" >&2; exit 1; }
  done
  grep -q " T ppoll$" <<<"$("$LLVM_NM" "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks ppoll" >&2; exit 1; }
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: -29 members (poll skips pollfds with no read/write interest; epoll_ctl takes Linux op numbers and returns -1 with errno, epoll_wait has no 64-event cap, epoll_pwait swaps the mask)"
R29_OBJ="$WORK/r29"
rm -rf "$R29_OBJ" && mkdir -p "$R29_OBJ/static" "$R29_OBJ/pic"
for flavour in static pic; do
  extra=()
  [[ $flavour == pic ]] && extra=(-fPIC -fvisibility=default)
  for m in poll epoll; do compile_r18 "$m" "$R29_OBJ/$flavour/$m.o" "${extra[@]}"; done
done
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R29_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" poll.o epoll.o)
  for m in poll epoll; do
    missing="$(comm -23 <(exported "$old/$m.o") <(exported "$R29_OBJ/$flavour/$m.o"))"
    [[ -z "$missing" ]] || { echo "homescoop: $v $m.o: the patched source lacks: $missing" >&2; exit 1; }
  done
  "$LLVM_AR" r "$lib" "$R29_OBJ/$flavour/poll.o" "$R29_OBJ/$flavour/epoll.o"
  have="$(exported "$lib" 2>/dev/null)"
  for s in poll ppoll epoll_create epoll_create1 epoll_ctl epoll_wait epoll_pwait; do
    grep -qx "$s" <<<"$have" || { echo "homescoop: $lib lacks $s" >&2; exit 1; }
  done
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: -30 members (named semaphores through slicc.sem_*, slicc-kernel#717; musl's file-based sem_open on kernels without them)"
R30_OBJ="$WORK/r30"
R30_DROP=(sem_destroy.o sem_getvalue.o sem_init.o sem_open.o sem_post.o sem_timedwait.o sem_trywait.o sem_unlink.o sem_wait.o)
rm -rf "$R30_OBJ" && mkdir -p "$R30_OBJ/static" "$R30_OBJ/pic"
compile_r20 "$HOMESCOOP_PKG/patches/sem.c" "$R30_OBJ/static/sem.o" "${MUSL_INC[@]}" -I"$MUSL/src/thread" -D_WASI_EMULATED_MMAN
compile_r20 "$HOMESCOOP_PKG/patches/sem.c" "$R30_OBJ/pic/sem.o" "${MUSL_INC[@]}" -I"$MUSL/src/thread" -D_WASI_EMULATED_MMAN -fPIC -fvisibility=default
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R30_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && "$LLVM_AR" x "$lib" "${R30_DROP[@]}")
  missing="$(comm -23 <(for o in "$old"/*.o; do exported "$o"; done | sort -u) <(exported "$R30_OBJ/$flavour/sem.o"))"
  [[ -z "$missing" ]] || { echo "homescoop: $v sem.o lacks: $missing" >&2; exit 1; }
  "$LLVM_AR" d "$lib" "${R30_DROP[@]}"
  "$LLVM_AR" r "$lib" "$R30_OBJ/$flavour/sem.o"
  if grep -qxE 'sem_(destroy|getvalue|init|open|post|timedwait|trywait|unlink|wait)\.o' <<<"$("$LLVM_AR" t "$lib")"; then
    echo "homescoop: $lib still has upstream semaphore members" >&2; exit 1
  fi
  grep -q __slicc_sem_open <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc.sem_open" >&2; exit 1; }
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: LICENSE from wasix-libc v2025-09-02.1"
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2025-09-02.1
LIC="$WORK/licenses"
mkdir -p "$LIC"
homescoop_fetch "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 "$LIC/wasix-libc-LICENSE"
homescoop_fetch "$WLIBC/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5 "$LIC/wasix-libc-LICENSE-APACHE-LLVM"
homescoop_fetch "$WLIBC/LICENSE-APACHE" a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2 "$LIC/wasix-libc-LICENSE-APACHE"
homescoop_fetch "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 "$LIC/wasix-libc-LICENSE-MIT"
homescoop_fetch "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af "$LIC/musl-COPYRIGHT"
homescoop_fetch "$WLIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0 "$LIC/cloudlibc-LICENSE"
homescoop_stage_licenses "$LIC/wasix-libc-LICENSE" "$LIC/wasix-libc-LICENSE-APACHE-LLVM" "$LIC/wasix-libc-LICENSE-APACHE" "$LIC/wasix-libc-LICENSE-MIT" "$LIC/musl-COPYRIGHT" "$LIC/cloudlibc-LICENSE"

homescoop_assert_no_package_links "$PKG"
echo "== wasix-sysroot: staged $(node -p "require('$PKG/package.json').version") from $BASE_VER"
