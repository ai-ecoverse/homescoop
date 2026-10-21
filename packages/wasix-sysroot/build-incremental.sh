#!/usr/bin/env bash
# wasix-sysroot 2025.9.30-33 on any host (CI): build-source.sh builds the five
# variants from wasix-libc v2026-07-03.1 and llvm-project 6bb93a24 (homescoop#890),
# and the steps below layer the -15…-32 libc changes on them.
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
VARIANTS=(sysroot sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic)
PIC_VARIANTS=" sysroot-ehpic sysroot-exnref-ehpic "

homescoop_load_recipe wasix-sysroot
PKG="$HOMESCOOP_PKG/package"
BASE="$WORK/source-out"
if [[ -z "${HOMESCOOP_SYSROOT_SOURCE_REUSE:-}" || ! -f "$BASE/.done" ]]; then
  bash "$HOMESCOOP_PKG/build-source.sh" "$BASE"
fi
BASE_VER="wasix-libc v2026-07-03.1 + llvm-project 6bb93a24 (from source)"
CLANG="$WORK/source-llvm/bin/clang"
LLVM_AR="$WORK/source-llvm/bin/llvm-ar"
LLVM_NM="$WORK/source-llvm/bin/llvm-nm"
RES="$("$CLANG" -print-resource-dir)"
test -x "$CLANG" && test -x "$LLVM_AR" && test -d "$RES"
arx() {
  local lib=$1 list m
  shift
  list="$("$LLVM_AR" t "$lib")"
  local -a want=()
  for m in "$@"; do
    case $'\n'"$list"$'\n' in *$'\n'"$m"$'\n'*) want+=("$m") ;; esac
  done
  if [ "${#want[@]}" -gt 0 ]; then "$LLVM_AR" x "$lib" "${want[@]}"; fi
}
for v in "${VARIANTS[@]}"; do
  test -f "$BASE/$v/lib/wasm32-wasip1/libc.a"
  rm -rf "${PKG:?}/$v"
  cp -R "$BASE/$v" "$PKG/$v"
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
# Upstream v2026-07-03.1 sources with chmod/fchmod/fchmodat/umask and
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
LLVM_NM="$WORK/source-llvm/bin/llvm-nm"
defined() { "$LLVM_NM" --defined-only -j "$1" | sort -u; }

echo "== wasix-sysroot: replace posix.o and at_fdcwd.o in every libc.a"
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$WORK/slicc-fs/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && arx "$lib" posix.o at_fdcwd.o)
  for src in posix at_fdcwd; do
    # The patched file must define everything the shipped object did: a
    # mismatch means the base libc is not v2026-07-03.1.
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
echo "== wasix-sysroot: -18 members (pselect, chdir, __tz, socketpair, sigaction; -32: sigaction seeds inherited SIG_IGN from slicc.sigaction_inherited)"
LIBC_TGZ="$WORK/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$LIBC_TGZ"
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
  (cd "$old" && arx "$lib" pselect.o chdir.o __tz.o socketpair.o sigaction.o)
  for m in pselect chdir __tz socketpair sigaction; do
    missing="$(comm -23 <(defined "$old/$m.o") <(defined "$R18_OBJ/$flavour/$m.o"))"
    if [[ -n "$missing" ]]; then
      echo "homescoop: $v $m.o: patched source lacks: $missing" >&2
      exit 1
    fi
  done
  "$LLVM_AR" r "$lib" "$R18_OBJ/$flavour/pselect.o" "$R18_OBJ/$flavour/chdir.o" "$R18_OBJ/$flavour/__tz.o" "$R18_OBJ/$flavour/socketpair.o" "$R18_OBJ/$flavour/sigaction.o"
  grep -q __slicc_sigaction_set <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc.sigaction_set" >&2; exit 1; }
  grep -q __slicc_sigaction_inherited <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc.sigaction_inherited" >&2; exit 1; }
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
  (cd "$old" && arx "$lib" setitimer.o getitimer.o clock_nanosleep.o sleep.o raise.o pthread_kill.o)
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
  if grep -qx __homescoop_itimer_real_left <<<"$("$LLVM_NM" -j "$lib" 2>/dev/null)"; then
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
R20_DROP=(setuid.o seteuid.o setgid.o setegid.o setgroups.o getuid.o geteuid.o getgid.o getegid.o)
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
  (cd "$old" && arx "$lib" slicc_identity.o "${R20_DROP[@]}")
  # Every global the replaced members defined is still defined.
  missing="$(comm -23 <(for o in "$old"/*.o; do exported "$o"; done | sort -u) <(for m in slicc_identity "${PASSWD[@]}"; do exported "$R20_OBJ/$flavour/$m.o"; done | sort -u))"
  if [[ -n "$missing" ]]; then
    echo "homescoop: $v -20 members lack: $missing" >&2
    exit 1
  fi
  "$LLVM_AR" d "$lib" "${R20_DROP[@]}"
  "$LLVM_AR" r "$lib" "$R20_OBJ/$flavour/slicc_identity.o" $(printf "$R20_OBJ/$flavour/%s.o " "${PASSWD[@]}")
  grep -qx getpw_r.o <<<"$("$LLVM_AR" t "$lib")"
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
  (cd "$old" && arx "$lib" tcgetattr.o tcsetattr.o tcflush.o tcdrain.o ioctl.o isatty.o)
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
WASM_LD="$WORK/source-llvm/bin/wasm-ld"
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
  (cd "$old" && arx "$lib" fork.o _Fork.o)
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
  (cd "$old" && arx "$lib" "${R24_DROP[@]}")
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
  (cd "$old" && arx "$lib" faccessat.o)
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
  (cd "$old" && arx "$lib" utimensat.o futimens.o clock.o times.o getrusage.o)
  (cd "$old/emu" && arx "$emu" clock.o)
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

echo "== wasix-sysroot: -28 members (pthread_sigmask, sigpending, sigsuspend, sigtimedwait, sigwaitinfo, sigwait, ppoll; slicc.sigmask_set / sigpending_get / sigmask_poll; -32: sigwait/sigwaitinfo/sigtimedwait through slicc.sigwait)"
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
  (cd "$old" && arx "$lib" "${R28_DROP[@]}")
  missing="$(comm -23 <(for o in "$old"/*.o; do exported "$o"; done | sort -u) <(exported "$R28_OBJ/$flavour/sigmask.o"))"
  [[ -z "$missing" ]] || { echo "homescoop: $v sigmask.o lacks: $missing" >&2; exit 1; }
  "$LLVM_AR" d "$lib" "${R28_DROP[@]}"
  "$LLVM_AR" r "$lib" "$R28_OBJ/$flavour/sigmask.o"
  if grep -qxE 'pthread_sigmask\.o|sigpending\.o|sigsuspend\.o|sigtimedwait\.o|sigwaitinfo\.o|sigwait\.o' <<<"$("$LLVM_AR" t "$lib")"; then
    echo "homescoop: $lib still has the upstream signal-mask members" >&2; exit 1
  fi
  for imp in __slicc_sigmask_set __slicc_sigmask_poll __slicc_sigwait; do
    grep -q "$imp" <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks $imp" >&2; exit 1; }
  done
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: -29 members (poll skips pollfds with no read/write interest; epoll_ctl takes Linux op numbers and returns -1 with errno, epoll_wait has no 64-event cap; -32: epoll_pwait through slicc.sigmask_epoll_wait, the mask swap on ENOSYS)"
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
  (cd "$old" && arx "$lib" poll.o epoll.o)
  for m in poll epoll; do
    missing="$(comm -23 <(exported "$old/$m.o") <(exported "$R29_OBJ/$flavour/$m.o"))"
    [[ -z "$missing" ]] || { echo "homescoop: $v $m.o: the patched source lacks: $missing" >&2; exit 1; }
  done
  "$LLVM_AR" r "$lib" "$R29_OBJ/$flavour/poll.o" "$R29_OBJ/$flavour/epoll.o"
  have="$(exported "$lib" 2>/dev/null)"
  for s in poll ppoll epoll_create epoll_create1 epoll_ctl epoll_wait epoll_pwait; do
    grep -qx "$s" <<<"$have" || { echo "homescoop: $lib lacks $s" >&2; exit 1; }
  done
  grep -q __slicc_sigmask_epoll_wait <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc.sigmask_epoll_wait" >&2; exit 1; }
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: -30 members (named semaphores through slicc.sem_*, slicc-kernel#717; musl's file-based sem_open on kernels without them)"
R30_OBJ="$WORK/r30"
R30_DROP=(sem_destroy.o sem_getvalue.o sem_init.o sem_open.o sem_post.o sem_timedwait.o sem_trywait.o sem_unlink.o sem_wait.o)
rm -rf "$R30_OBJ" && mkdir -p "$R30_OBJ/static" "$R30_OBJ/pic"
compile_r20 "$HOMESCOOP_PKG/patches/sem.c" "$R30_OBJ/static/sem.o" "${MUSL_INC[@]}" -I"$MUSL/src/thread" -D_WASI_EMULATED_MMAN
compile_r20 "$HOMESCOOP_PKG/patches/sem.c" "$R30_OBJ/pic/sem.o" "${MUSL_INC[@]}" -I"$MUSL/src/thread" -D_WASI_EMULATED_MMAN -fPIC -fvisibility=default
compile_r20 "$MUSL/src/mman/shm_open.c" "$R30_OBJ/static/shm_open.o" "${MUSL_INC[@]}" -D_WASI_EMULATED_MMAN
compile_r20 "$MUSL/src/mman/shm_open.c" "$R30_OBJ/pic/shm_open.o" "${MUSL_INC[@]}" -D_WASI_EMULATED_MMAN -fPIC -fvisibility=default
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R30_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && arx "$lib" "${R30_DROP[@]}")
  have_shm=0
  grep -qx shm_open.o <<<"$("$LLVM_AR" t "$lib")" && have_shm=1
  news=("$R30_OBJ/$flavour/sem.o")
  ((have_shm)) || news+=("$R30_OBJ/$flavour/shm_open.o")
  missing="$(comm -23 <(for o in "$old"/*.o; do exported "$o"; done | sort -u) <(for o in "${news[@]}"; do exported "$o"; done | sort -u))"
  [[ -z "$missing" ]] || { echo "homescoop: $v sem.o lacks: $missing" >&2; exit 1; }
  "$LLVM_AR" d "$lib" "${R30_DROP[@]}"
  "$LLVM_AR" r "$lib" "${news[@]}"
  if grep -qxE 'sem_(destroy|getvalue|init|open|post|timedwait|trywait|unlink|wait)\.o' <<<"$("$LLVM_AR" t "$lib")"; then
    echo "homescoop: $lib still has upstream semaphore members" >&2; exit 1
  fi
  grep -q __slicc_sem_open <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc.sem_open" >&2; exit 1; }
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: -30 fcntl F_GETLK/F_SETLK/F_SETLKW through slicc.fcntl_lock (homescoop#407, slicc-kernel#722), lockf"
for v in "${VARIANTS[@]}"; do
  python3 - "$PKG/$v/include" <<'PYHDR'
import sys
from pathlib import Path
inc = Path(sys.argv[1])
edits = [
    (inc / "__header_fcntl.h", "#define F_DUPFD_CLOEXEC (6)\n", "#define F_DUPFD_CLOEXEC (6)\n#define F_GETLK (12)\n#define F_SETLK (13)\n#define F_SETLKW (14)\n#define F_RDLCK (0)\n#define F_WRLCK (1)\n#define F_UNLCK (2)\n"),
    (inc / "unistd.h", "#ifdef __wasilibc_unmodified_upstream /* WASI has no POSIX file locking */\nint lockf(int, int, off_t);\n#endif\n", "int lockf(int, int, off_t);\n"),
    (inc / "unistd.h", "#ifdef __wasilibc_unmodified_upstream /* WASI has no POSIX file locking */\n#define lockf64 lockf\n#endif\n", "#define lockf64 lockf\n"),
]
for path, old, new in edits:
    t = path.read_text()
    if old not in t and new in t:
        continue
    if t.count(old) != 1:
        sys.exit(f"{path}: not found: {old.splitlines()[0]}")
    path.write_text(t.replace(old, new))
PYHDR
done
R30L_OBJ="$WORK/r30l"
rm -rf "$R30L_OBJ" && mkdir -p "$R30L_OBJ/static" "$R30L_OBJ/pic"
for flavour in static pic; do
  extra=()
  [[ $flavour == pic ]] && extra=(-fPIC -fvisibility=default)
  compile_r18 fcntl "$R30L_OBJ/$flavour/fcntl.o" "${extra[@]}"
  compile_r20 "$MUSL/src/misc/lockf.c" "$R30L_OBJ/$flavour/lockf.o" "${MUSL_INC[@]}" "${extra[@]}"
done
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R30L_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && arx "$lib" fcntl.o)
  missing="$(comm -23 <(exported "$old/fcntl.o") <(exported "$R30L_OBJ/$flavour/fcntl.o"))"
  [[ -z "$missing" ]] || { echo "homescoop: $v fcntl.o lacks: $missing" >&2; exit 1; }
  if grep -qx lockf.o <<<"$("$LLVM_AR" t "$lib")"; then echo "homescoop: $lib already has lockf.o" >&2; exit 1; fi
  "$LLVM_AR" r "$lib" "$R30L_OBJ/$flavour/fcntl.o" "$R30L_OBJ/$flavour/lockf.o"
  have="$(exported "$lib" 2>/dev/null)"
  for sym in fcntl lockf lockf64; do
    grep -qx "$sym" <<<"$have" || { echo "homescoop: $lib lacks $sym" >&2; exit 1; }
  done
  grep -q __slicc_fcntl_lock <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc.fcntl_lock" >&2; exit 1; }
  grep -q "#define F_SETLK (13)" "$PKG/$v/include/__header_fcntl.h"
  ! grep -q "WASI has no POSIX file locking" "$PKG/$v/include/unistd.h"
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: -31 AF_UNIX addresses both ways: getsockname/getpeername/accept/recvfrom/recvmsg fill sockaddr_un, bind/connect/sendto/sendmsg take sizeof(struct sockaddr_un) (patches/common/net.h, homescoop#515)"
R31_OBJ="$WORK/r31"
R31=(getsockname getpeername accept recvfrom recvmsg bind connect sendto sendmsg)
rm -rf "$R31_OBJ" && mkdir -p "$R31_OBJ/static" "$R31_OBJ/pic"
for flavour in static pic; do
  extra=()
  [[ $flavour == pic ]] && extra=(-fPIC -fvisibility=default)
  for m in "${R31[@]}"; do
    compile_r20 "$LIBC_SRC/libc-bottom-half/cloudlibc/src/libc/sys/socket/$m.c" "$R31_OBJ/$flavour/$m.o" -I"$HOMESCOOP_PKG/patches" "${BOTTOM_INC[@]}" "${extra[@]}"
  done
done
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  old="$R31_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && arx "$lib" $(printf "%s.o " "${R31[@]}"))
  for m in "${R31[@]}"; do
    missing="$(comm -23 <(exported "$old/$m.o") <(exported "$R31_OBJ/$flavour/$m.o"))"
    [[ -z "$missing" ]] || { echo "homescoop: $v $m.o: the patched build lacks: $missing" >&2; exit 1; }
  done
  "$LLVM_AR" r "$lib" $(printf "$R31_OBJ/$flavour/%s.o " "${R31[@]}")
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: -36 uname() nodename from /etc/hostname (-42, homescoop#1462), then HOSTNAME (slicc-kernel's node name), not wasmer.sh (homescoop#1050)"
R36_OBJ="$WORK/r36"
rm -rf "$R36_OBJ" && mkdir -p "$R36_OBJ/static" "$R36_OBJ/pic"
compile_r18 uname "$R36_OBJ/static/uname.o"
compile_r18 uname "$R36_OBJ/pic/uname.o" -fPIC -fvisibility=default
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  grep -qx uname.o <<<"$("$LLVM_AR" t "$lib")" || { echo "homescoop: $lib has no uname.o" >&2; exit 1; }
  old="$R36_OBJ/old-$v"
  rm -rf "$old" && mkdir -p "$old"
  (cd "$old" && arx "$lib" uname.o)
  missing="$(comm -23 <(exported "$old/uname.o") <(exported "$R36_OBJ/$flavour/uname.o"))"
  [[ -z "$missing" ]] || { echo "homescoop: $v uname.o lacks: $missing" >&2; exit 1; }
  "$LLVM_AR" r "$lib" "$R36_OBJ/$flavour/uname.o"
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: -36 sigsetjmp as a setjmp call site, siglongjmp restores the mask (EH trees; homescoop#1059)"
for v in sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic; do
  python3 - "$PKG/$v/include/setjmp.h" <<'PYHDR'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text()
old = "\tint sigsetjmp(sigjmp_buf, int) __setjmp_attr;\n\t_Noreturn void siglongjmp(sigjmp_buf, int);\n#endif\n"
new = ("\tint sigsetjmp(sigjmp_buf, int) __setjmp_attr;\n\t_Noreturn void siglongjmp(sigjmp_buf, int);\n"
       "\t/* homescoop (#1059): LLVM's wasm sjlj lowering rewrites only setjmp call\n"
       "\t * sites, so sigsetjmp records the mask and then is setjmp at the call site. */\n"
       "\tint __homescoop_sigsetjmp_save(sigjmp_buf, int);\n"
       "\t/* -40 (#1120): env once, as glibc's sigsetjmp evaluates it. */\n"
       "#define sigsetjmp(env, save) __extension__ ({ __typeof__(&(env)[0]) __hs_env = (env); __homescoop_sigsetjmp_save(__hs_env, (save)) + setjmp(__hs_env); })\n#endif\n")
if new in t:
    sys.exit(0)
if t.count(old) != 1:
    sys.exit(f"{p}: no single sigsetjmp declaration in the EH branch")
p.write_text(t.replace(old, new))
PYHDR
  grep -q '__homescoop_sigsetjmp_save(__hs_env' "$PKG/$v/include/setjmp.h"
done
R36J="$WORK/r36j"
rm -rf "$R36J" && mkdir -p "$R36J/static" "$R36J/pic"
compile_r18 sigjmp "$R36J/static/siglongjmp.o" -fwasm-exceptions -mllvm -wasm-enable-sjlj -isystem "$PKG/sysroot-eh/include" -D_GNU_SOURCE
compile_r18 sigjmp "$R36J/pic/siglongjmp.o" -fwasm-exceptions -mllvm -wasm-enable-sjlj -isystem "$PKG/sysroot-eh/include" -D_GNU_SOURCE -fPIC -fvisibility=default
for v in sysroot-eh sysroot-ehpic sysroot-exnref-eh sysroot-exnref-ehpic; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  grep -qx siglongjmp.o <<<"$("$LLVM_AR" t "$lib")" || { echo "homescoop: $lib has no siglongjmp.o" >&2; exit 1; }
  "$LLVM_AR" r "$lib" "$R36J/$flavour/siglongjmp.o"
  grep -qx __homescoop_sigsetjmp_save <<<"$(exported "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks __homescoop_sigsetjmp_save" >&2; exit 1; }
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: __wasi_proc_raise_interval2 in the PIC trees, as in -32 (patches/proc_raise_interval2.c, homescoop#943)"
PRI_OBJ="$WORK/pri"
rm -rf "$PRI_OBJ" && mkdir -p "$PRI_OBJ"
for v in sysroot-ehpic sysroot-exnref-ehpic; do
  hdr="$PKG/$v/include/wasi/api_wasix.h"
  if ! grep -q '__wasi_proc_raise_interval2(' "$hdr"; then
    python3 - "$hdr" <<'PYHDR'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text()
mark = "/**\n * Forks the current process into a new subprocess. If the function\n"
decl = """/**
 * Send a signal after an initial delay, optionally repeating (it_value + it_interval).
 * Nanoseconds. Added as proc_raise_interval2; legacy proc_raise_interval unchanged.
 */
__wasi_errno_t __wasi_proc_raise_interval2(
    __wasi_signal_t sig,
    __wasi_timestamp_t initial,
    __wasi_timestamp_t interval,
    __wasi_bool_t repeat
) __attribute__((__warn_unused_result__));
"""
if t.count(mark) != 1:
    sys.exit(f"{p}: no single proc_fork comment to insert before")
p.write_text(t.replace(mark, decl + mark))
PYHDR
  fi
  "$CLANG" --target=wasm32-wasip1 --sysroot="$PKG/$v" -resource-dir="$RES" -isystem "$PKG/$v/include" \
    -matomics -mbulk-memory -mmutable-globals -pthread -O2 -fPIC -fvisibility=default \
    -c "$HOMESCOOP_PKG/patches/proc_raise_interval2.c" -o "$PRI_OBJ/$v.o"
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  if grep -qx __wasi_proc_raise_interval2 <<<"$(exported "$lib" 2>/dev/null)"; then echo "homescoop: $lib already defines __wasi_proc_raise_interval2" >&2; exit 1; fi
  cp "$PRI_OBJ/$v.o" "$PRI_OBJ/proc_raise_interval2.o"
  "$LLVM_AR" r "$lib" "$PRI_OBJ/proc_raise_interval2.o"
  grep -qx __wasi_proc_raise_interval2 <<<"$(exported "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks __wasi_proc_raise_interval2" >&2; exit 1; }
  echo "  $v"
done

echo "== wasix-sysroot: -34 flock() through slicc.flock (slicc-kernel#893; fcntl whole-file lock on ENOSYS); mkfifo/mkfifoat/mknod/mknodat through slicc_fs.path_mkfifo (#878, slicc-kernel#957)"
for v in "${VARIANTS[@]}"; do
  python3 - "$PKG/$v/include/sys/stat.h" <<'PYHDR'
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text()
edits = [
    ("#ifdef __wasilibc_unmodified_upstream /* WASI has no fifo */\nint mkfifo(const char *, mode_t);\n#endif\n", "int mkfifo(const char *, mode_t);\n"),
    ("#ifdef __wasilibc_unmodified_upstream /* WASI has no fifo */\nint mkfifoat(int, const char *, mode_t);\n#endif\n", "int mkfifoat(int, const char *, mode_t);\n"),
    ("#ifdef __wasilibc_unmodified_upstream /* WASI has no mknod */\n#if defined(_XOPEN_SOURCE) || defined(_GNU_SOURCE) || defined(_BSD_SOURCE)\nint mknod(const char *, mode_t, dev_t);\nint mknodat(int, const char *, mode_t, dev_t);\n#endif\n#endif\n",
     "#if defined(_XOPEN_SOURCE) || defined(_GNU_SOURCE) || defined(_BSD_SOURCE)\nint mknod(const char *, mode_t, dev_t);\nint mknodat(int, const char *, mode_t, dev_t);\n#endif\n"),
]
for old, new in edits:
    if old not in t and new in t:
        continue
    if t.count(old) != 1:
        sys.exit(f"{p}: not found: {old.splitlines()[1]}")
    t = t.replace(old, new)
p.write_text(t)
PYHDR
  ! grep -q "WASI has no fifo\|WASI has no mknod" "$PKG/$v/include/sys/stat.h"
done
R34_OBJ="$WORK/r34"
rm -rf "$R34_OBJ" && mkdir -p "$R34_OBJ/static" "$R34_OBJ/pic"
for m in flock mkfifo; do
  compile_r18 $m "$R34_OBJ/static/$m.o"
  compile_r18 $m "$R34_OBJ/pic/$m.o" -fPIC -fvisibility=default
done
for v in "${VARIANTS[@]}"; do
  lib="$PKG/$v/lib/wasm32-wasip1/libc.a"
  flavour=static
  [[ "$PIC_VARIANTS" == *" $v "* ]] && flavour=pic
  for sym in mkfifo mkfifoat mknod mknodat; do
    if grep -qx "$sym" <<<"$(exported "$lib" 2>/dev/null)"; then echo "homescoop: $lib already defines $sym" >&2; exit 1; fi
  done
  "$LLVM_AR" r "$lib" "$R34_OBJ/$flavour/mkfifo.o"
  for sym in mkfifo mkfifoat mknod mknodat; do
    grep -qx "$sym" <<<"$(exported "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks $sym" >&2; exit 1; }
  done
  grep -q __slicc_fs_path_mkfifo <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc_fs.path_mkfifo" >&2; exit 1; }
  if grep -qx flock.o <<<"$("$LLVM_AR" t "$lib")"; then echo "homescoop: $lib already has flock.o" >&2; exit 1; fi
  if grep -qx flock <<<"$(exported "$lib" 2>/dev/null)"; then echo "homescoop: $lib already defines flock" >&2; exit 1; fi
  "$LLVM_AR" r "$lib" "$R34_OBJ/$flavour/flock.o"
  grep -qx flock <<<"$(exported "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks flock" >&2; exit 1; }
  grep -q __slicc_flock <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks slicc.flock" >&2; exit 1; }
  for imp in __slicc_sigwait_info __slicc_siginfo_take; do
    grep -q "$imp" <<<"$("$LLVM_NM" -u "$lib" 2>/dev/null)" || { echo "homescoop: $lib lacks $imp" >&2; exit 1; }
  done
  echo "  $v ($flavour)"
done

echo "== wasix-sysroot: LICENSE from wasix-libc v2026-07-03.1"
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2026-07-03.1
LIC="$WORK/licenses"
mkdir -p "$LIC"
homescoop_fetch "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 "$LIC/wasix-libc-LICENSE"
homescoop_fetch "$WLIBC/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5 "$LIC/wasix-libc-LICENSE-APACHE-LLVM"
homescoop_fetch "$WLIBC/LICENSE-APACHE" a60eea817514531668d7e00765731449fe14d059d3249e0bc93b36de45f759f2 "$LIC/wasix-libc-LICENSE-APACHE"
homescoop_fetch "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 "$LIC/wasix-libc-LICENSE-MIT"
homescoop_fetch "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af "$LIC/musl-COPYRIGHT"
homescoop_fetch "$WLIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0 "$LIC/cloudlibc-LICENSE"
homescoop_stage_licenses "$LIC/wasix-libc-LICENSE" "$LIC/wasix-libc-LICENSE-APACHE-LLVM" "$LIC/wasix-libc-LICENSE-APACHE" "$LIC/wasix-libc-LICENSE-MIT" "$LIC/musl-COPYRIGHT" "$LIC/cloudlibc-LICENSE"

LLS="$WORK/source-llvm-project"
homescoop_notices_begin "The five sysroots are built from source (build-source.sh): wasix-libc v2026-07-03.1 (https://github.com/wasix-org/wasix-libc/tree/v2026-07-03.1) with our changes in patches/, and the LLVM runtimes from llvm-project 6bb93a243f6d15855f485f5aec3810d9e2de150d, the commit that tag pins (https://github.com/wasix-org/llvm-project/tree/6bb93a243f6d15855f485f5aec3810d9e2de150d). Up to 2025.9.30-32 the libc came from a local build (npm -14) of the same wasix-libc line: its __wasi_proc_spawn3, proc_exec4 and __wasi_context_* symbols first appear in v2026-06-25.1/v2026-07-03.1, not in v2025-09-02.1, which its recipe named."
homescoop_notice "wasix-libc v2026-07-03.1 (libc, crt, headers; Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT)" "$LIC/wasix-libc-LICENSE" - "$LIC/wasix-libc-LICENSE-APACHE-LLVM" - "$LIC/wasix-libc-LICENSE-MIT" -
homescoop_notice "musl (libc-top-half; MIT)" "$LIC/musl-COPYRIGHT" -
homescoop_notice "cloudlibc (libc-bottom-half; BSD-2-Clause)" "$LIC/cloudlibc-LICENSE" -
homescoop_notice "libc++ 20.1 (llvm-project 6bb93a24; Apache-2.0 WITH LLVM-exception)" "$LLS/libcxx/LICENSE.TXT" -
homescoop_notice "libc++abi 20.1 (llvm-project 6bb93a24; Apache-2.0 WITH LLVM-exception)" "$LLS/libcxxabi/LICENSE.TXT" -
homescoop_notice "libunwind 20.1 (llvm-project 6bb93a24; Apache-2.0 WITH LLVM-exception)" "$LLS/libunwind/LICENSE.TXT" -
homescoop_notice "compiler-rt 20.1 (builtins, profile; llvm-project 6bb93a24; Apache-2.0 WITH LLVM-exception)" "$LLS/compiler-rt/LICENSE.TXT" -

homescoop_assert_no_package_links "$PKG"
echo "== wasix-sysroot: staged $(node -p "require('$PKG/package.json').version") from $BASE_VER"
