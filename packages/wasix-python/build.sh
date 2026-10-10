#!/usr/bin/env bash
# CPython 3.14 for slicc WASIX, cross-built from source (homescoop#181):
# a dynamic-main python.wasm on the pinned wasix-sysroot's sysroot-ehpic (legacy
# wasm EH, PIC; side modules load by dlopen), with its stdlib.
#
# Steps: host CPython 3.14.2 (the build python, from the same tarball) →
# static PIC deps (bzip2, xz, sqlite, ncurses tinfo, readline; zlib and
# OpenSSL from the wasix-zlib / wasix-openssl dev packages) → configure +
# make (modules found by configure via pkg-config) → asyncify + strip →
# stage, prune, pip, compileall → checks.
#
# Everything is built under a fixed root (WASIX_PYTHON_BUILD_ROOT, default
# /tmp/homescoop-wasix-python), so the paths in _sysconfigdata and the
# tarball do not depend on the runner's checkout. HOMESCOOP_STOP_AFTER=deps
# stops after the dependencies (a small local probe).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-python

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="${WASIX_PYTHON_BUILD_ROOT:-/tmp/homescoop-wasix-python}"
DL="$B/dl"
DEPS="$B/deps"
CROSS="$B/Python-$VER/cross-build/wasm32-wasix"
PREFIX_PY="$B/prefix"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
# The CPython 3.14.2 release date: __DATE__/__TIME__ (sys.version) and
# archive mtimes.
export SOURCE_DATE_EPOCH=1764892800
export PYTHONHASHSEED=0
export ZERO_AR_DATE=1
mkdir -p "$B" "$DL" "$DEPS/lib/pkgconfig" "$DEPS/include"

# --- tools -------------------------------------------------------------------
# prestage-check.sh disassembles with wabt's wasm-objdump: a pinned 1.0.42
# (Ubuntu's 1.0.34 cannot read python.wasm: legacy EH + threads).
if [[ -z "${WASM_OBJDUMP:-}" ]]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) WABT_ASSET=linux-x64 WABT_SHA=84895407a6bbb80e918f33b16b2fb2206021c150b6bc9ff6f761263a745ab131 ;;
    Darwin-arm64) WABT_ASSET=macos-arm64 WABT_SHA=3f654779b436c628db3ca4323c51538815f5fbc887a6d5f3bb1c18d36281e240 ;;
    *) echo "homescoop wasix-python: no pinned wabt for $(uname -s)-$(uname -m); set WASM_OBJDUMP" >&2; exit 1 ;;
  esac
  if [[ ! -x "$B/wabt/bin/wasm-objdump" ]]; then
    homescoop_fetch "https://github.com/WebAssembly/wabt/releases/download/1.0.42/wabt-1.0.42-$WABT_ASSET.tar.gz" "$WABT_SHA" "$DL/wabt-1.0.42.tar.gz"
    rm -rf "$B/wabt" && mkdir -p "$B/wabt"
    tar xzf "$DL/wabt-1.0.42.tar.gz" -C "$B/wabt" --strip-components=1
  fi
  export WASM_OBJDUMP="$B/wabt/bin/wasm-objdump"
fi
"$WASM_OBJDUMP" --version
for t in pkg-config unzip make; do
  command -v "$t" >/dev/null || { echo "homescoop wasix-python: need $t" >&2; exit 1; }
done

# --- sources -----------------------------------------------------------------
fetch_src() { # fetch_src <recipe source name> -> sets SRC_FILE
  local name=$1 url_var sha_var
  homescoop_load_recipe wasix-python --source "$name"
  url_var="${name^^}_SRC_URL"; sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe wasix-python
PY_TGZ="$DL/Python-$VER.tgz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$PY_TGZ"

# --- host CPython (the build python) ------------------------------------------
HOSTPY="$B/host/bin/python3.14"
if [[ ! -x "$HOSTPY" ]]; then
  echo "== wasix-python: host CPython $VER"
  rm -rf "$B/host-src" && mkdir -p "$B/host-src"
  tar xzf "$PY_TGZ" -C "$B/host-src" --strip-components=1
  (
    cd "$B/host-src"
    unset CC CFLAGS LDFLAGS CPPFLAGS
    # Only a build python (freeze, compileall): no host OpenSSL, whose
    # pick-up varies by machine (a Homebrew 3.x mismatch fails sharedinstall).
    ./configure --prefix="$B/host" --without-ensurepip --disable-test-modules \
      py_cv_module__ssl=n/a py_cv_module__hashlib=n/a >"$B/host-configure.log" 2>&1
    make -j"$JOBS" >"$B/host-make.log" 2>&1
    make install >"$B/host-install.log" 2>&1
  ) || { tail -40 "$B"/host-*.log >&2; exit 1; }
fi
"$HOSTPY" -c 'import sys; assert sys.version_info[:3] == (3, 14, 2), sys.version'

# --- WASIX toolchain ---------------------------------------------------------
# Pinned wasixcc + wasix-sysroot 2025.9.30-18. sysroot-ehpic (legacy EH, PIC)
# already has the setitimer → proc_raise_interval2 and clock_nanosleep EINTR
# libc patches (patches/README.md); advisory locks are lock_stubs.c below.
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$B/wasixcc")"
# C++ runtime ABI of the side modules (README "Side modules"): the published
# py-* extensions import _Unwind_CallPersonality, __cxa_thread_atexit and a
# plain (not thread_local) __wasm_lpad_context from python.wasm, as 3.14.2-11
# exported them. wasix-sysroot >= -14's rebuilt libc++ runtimes have none of
# that, so python links the libc++/libc++abi/libunwind of upstream wasix-libc
# v2026-07-03.1 sysroot-ehpic (what -11 was linked against, byte for byte).
CXXRT_URL="https://github.com/wasix-org/wasix-libc/releases/download/v2026-07-03.1/sysroot-ehpic.tar.gz"
CXXRT_SHA="54e00486bd0ab658009120c3980b967f96c95ec2ec10d23ba49261b9931927d0"
CXXRT="$B/cxxrt"
rm -rf "$CXXRT" && mkdir -p "$CXXRT"
homescoop_fetch "$CXXRT_URL" "$CXXRT_SHA" "$CXXRT/sysroot-ehpic.tar.gz"
tar xzf "$CXXRT/sysroot-ehpic.tar.gz" -C "$CXXRT"
EHPIC_LIB="$WASIXCC_SYSROOT_PREFIX/sysroot-ehpic/lib/wasm32-wasip1"
for a in libc++.a libc++abi.a libc++experimental.a libunwind.a; do
  cp "$CXXRT/wasix-sysroot-ehpic/sysroot/lib/wasm32-wasi/$a" "$EHPIC_LIB/$a"
done
WASM_OPT="$WASIXCC_BINARYEN_LOCATION/bin/wasm-opt"
LLVM_NM="$WASIXCC_LLVM_LOCATION/bin/llvm-nm"
export WASIXCC_RUN_WASM_OPT=no WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes
export WASIXCC_MODULE_KIND=dynamic-main WASIXCC_INCLUDE_CPP_SYMBOLS=yes
export AR=wasixar RANLIB=wasixranlib CC=wasixcc
unset CXX CFLAGS CPPFLAGS LDFLAGS LIBS FREETYPE FREETYPE_ROOT JPEG JPEG_ROOT PNG_ROOT ZLIB_ROOT ZLIB VIRTUAL_ENV PYTHONPATH
# configure sees the WASIX dev packages' and our deps' .pc files, never the host's.
export PKG_CONFIG_LIBDIR="$DEPS/lib/pkgconfig"
export PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR"
SYSROOT_LIBC="$WASIXCC_SYSROOT_PREFIX/sysroot-ehpic/lib/wasm32-wasip1/libc.a"
"$WASIXCC_LLVM_LOCATION/bin/llvm-nm" --defined-only -j "$EHPIC_LIB/libunwind.a" 2>/dev/null | grep -qx _Unwind_CallPersonality \
  || { echo "homescoop wasix-python: libunwind lacks _Unwind_CallPersonality (side-module ABI)" >&2; exit 1; }
"$LLVM_NM" --defined-only "$SYSROOT_LIBC" 2>/dev/null | grep -q ' T __wasi_proc_raise_interval2$' \
  || { echo "homescoop wasix-python: sysroot-ehpic libc lacks proc_raise_interval2 (setitimer patch)" >&2; exit 1; }

EMU="-D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_MMAN"
DEP_CFLAGS="-O2 -fPIC -matomics -mbulk-memory -mmutable-globals -pthread -mthread-model posix $EMU -ffile-prefix-map=$B=."
CROSS_HOST=wasm32-unknown-wasi

write_pc() { # write_pc <name> <version> <libs> [requires.private]
  cat >"$DEPS/lib/pkgconfig/$1.pc" <<EOF
prefix=$DEPS
libdir=\${prefix}/lib
includedir=\${prefix}/include

Name: $1
Description: $1 (homescoop wasix-python build, static PIC)
Version: $2
Requires.private: ${4:-}
Libs: -L\${libdir} $3
Cflags: -I\${includedir}
EOF
}

# --- deps: zlib, OpenSSL (dev packages, lib-pic) ----------------------------
for dep in wasix_zlib wasix_openssl; do
  fetch_src "$dep"
  d="$DEPS/${dep//_/-}"
  rm -rf "$d" && mkdir -p "$d"
  tar xzf "$SRC_FILE" -C "$d"
done
# Their lib-pic .pc files are relative to ${pcfiledir}: search them where
# they are (Linux pkg-config does not resolve symlinks for pcfiledir).
export PKG_CONFIG_LIBDIR="$DEPS/wasix-zlib/package/lib-pic/pkgconfig:$DEPS/wasix-openssl/package/lib-pic/pkgconfig:$DEPS/lib/pkgconfig"
export PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR"
test -f "$DEPS/wasix-zlib/package/lib-pic/libz.a"
test -f "$DEPS/wasix-openssl/package/lib-pic/libssl.a"

# --- deps: bzip2 ---------------------------------------------------------------
if [[ ! -f "$DEPS/lib/libbz2.a" ]]; then
  echo "== wasix-python: bzip2"
  fetch_src bzip2
  rm -rf "$B/bzip2" && mkdir -p "$B/bzip2"
  tar xzf "$SRC_FILE" -C "$B/bzip2" --strip-components=1
  (
    cd "$B/bzip2"
    for f in blocksort huffman crctable randtable compress decompress bzlib; do
      # shellcheck disable=SC2086
      wasixcc $DEP_CFLAGS -D_FILE_OFFSET_BITS=64 -c "$f.c" -o "$f.o"
    done
    wasixar rcs "$DEPS/lib/libbz2.a" blocksort.o huffman.o crctable.o randtable.o compress.o decompress.o bzlib.o
    cp bzlib.h "$DEPS/include/"
  )
  write_pc bzip2 1.0.8 -lbz2
fi

# --- deps: xz (liblzma) ------------------------------------------------------
if [[ ! -f "$DEPS/lib/liblzma.a" ]]; then
  echo "== wasix-python: xz"
  fetch_src xz
  rm -rf "$B/xz" && mkdir -p "$B/xz"
  tar xJf "$SRC_FILE" -C "$B/xz" --strip-components=1
  (
    cd "$B/xz"
    ./configure --host="$CROSS_HOST" --prefix="$DEPS" --disable-shared --enable-static \
      --disable-xz --disable-xzdec --disable-lzmadec --disable-lzmainfo --disable-lzma-links \
      --disable-scripts --disable-doc --disable-nls --enable-threads=no \
      CC=wasixcc CFLAGS="$DEP_CFLAGS" >"$B/xz-configure.log" 2>&1
    make -j"$JOBS" -C src/liblzma >"$B/xz-make.log" 2>&1
    make -C src/liblzma install >>"$B/xz-make.log" 2>&1
  ) || { tail -40 "$B"/xz-*.log >&2; exit 1; }
  rm -f "$DEPS"/lib/liblzma.la
fi

# --- deps: SQLite (amalgamation) -----------------------------------------------
# Compile options as 3.14.2-11's (PRAGMA compile_options there).
if [[ ! -f "$DEPS/lib/libsqlite3.a" ]]; then
  echo "== wasix-python: sqlite"
  fetch_src sqlite
  rm -rf "$B/sqlite" && mkdir -p "$B/sqlite"
  unzip -q -o "$SRC_FILE" -d "$B/sqlite"
  SQ="$(echo "$B"/sqlite/sqlite-amalgamation-*)"
  # shellcheck disable=SC2086
  wasixcc $DEP_CFLAGS -DSQLITE_THREADSAFE=1 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_OMIT_WAL \
    -DSQLITE_ENABLE_COLUMN_METADATA -DSQLITE_ENABLE_DBSTAT_VTAB -DSQLITE_ENABLE_FTS5 \
    -DSQLITE_ENABLE_MATH_FUNCTIONS -DSQLITE_ENABLE_RTREE -DSQLITE_DEFAULT_AUTOVACUUM=0 \
    -DSQLITE_DEFAULT_RECURSIVE_TRIGGERS=0 -DSQLITE_DISABLE_LFS \
    -c "$SQ/sqlite3.c" -o "$B/sqlite/sqlite3.o"
  wasixar rcs "$DEPS/lib/libsqlite3.a" "$B/sqlite/sqlite3.o"
  cp "$SQ/sqlite3.h" "$SQ/sqlite3ext.h" "$DEPS/include/"
  SQV="$(sed -n 's/^#define SQLITE_VERSION *"\(.*\)"/\1/p' "$SQ/sqlite3.h")"
  write_pc sqlite3 "$SQV" -lsqlite3
fi

# --- deps: ncurses tinfo (termcap for readline) --------------------------------
# libtinfo only, with compiled-in descriptions (no terminfo database at run
# time); tgetent/tgetstr come from its termcap emulation.
if [[ ! -f "$DEPS/lib/libtinfo.a" ]]; then
  echo "== wasix-python: ncurses (tinfo)"
  fetch_src ncurses
  rm -rf "$B/ncurses" && mkdir -p "$B/ncurses"
  tar xzf "$SRC_FILE" -C "$B/ncurses" --strip-components=1
  (
    cd "$B/ncurses"
    ./configure --host="$CROSS_HOST" --build="$(sh ./config.guess)" --prefix="$DEPS" \
      --without-shared --with-normal --without-debug --without-profile \
      --without-cxx --without-cxx-binding --without-ada --without-progs --without-tests \
      --without-manpages --without-pkg-config --disable-db-install --disable-database \
      --with-fallbacks=xterm-256color,xterm,screen-256color,screen,tmux-256color,vt100,linux,dumb \
      --with-termlib --enable-termcap --disable-home-terminfo --disable-widec \
      --with-build-cc=cc --with-build-cflags=-O2 \
      CC=wasixcc CFLAGS="$DEP_CFLAGS" >"$B/ncurses-configure.log" 2>&1
    make -j"$JOBS" -C include >"$B/ncurses-make.log" 2>&1
    make -j"$JOBS" -C ncurses libs >>"$B/ncurses-make.log" 2>&1
    make -C include install >>"$B/ncurses-make.log" 2>&1
    make -C ncurses install.libs >>"$B/ncurses-make.log" 2>&1
  ) || { tail -60 "$B"/ncurses-*.log >&2; exit 1; }
  write_pc tinfo 6.5 -ltinfo
fi

# --- deps: readline ------------------------------------------------------------
if [[ ! -f "$DEPS/lib/libreadline.a" ]]; then
  echo "== wasix-python: readline"
  fetch_src readline
  rm -rf "$B/readline" && mkdir -p "$B/readline"
  tar xzf "$SRC_FILE" -C "$B/readline" --strip-components=1
  (
    cd "$B/readline"
    # Cross answers readline's configure cannot probe (Linux/glibc values).
    # NEED_EXTERN_PC: terminal.c then only declares PC/BC/UP, which tinfo
    # defines (else a duplicate symbol at python.wasm's link).
    export bash_cv_termcap_lib=libtinfo bash_cv_func_sigsetjmp=present \
      bash_cv_func_strcoll_broken=no bash_cv_must_reinstall_sighandlers=no \
      bash_cv_func_ctype_nonascii=no bash_cv_dup2_broken=no \
      bash_cv_getpw_declared=yes bash_cv_void_sighandler=yes
    ./configure --host="$CROSS_HOST" --build="$(sh ./support/config.guess)" --prefix="$DEPS" \
      --disable-shared --enable-static --with-curses --disable-install-examples \
      CC=wasixcc CFLAGS="$DEP_CFLAGS -DNEED_EXTERN_PC" CPPFLAGS="-I$DEPS/include" LDFLAGS="-L$DEPS/lib" \
      >"$B/readline-configure.log" 2>&1
    make -j"$JOBS" static >"$B/readline-make.log" 2>&1
    make install-static install-headers >>"$B/readline-make.log" 2>&1
  ) || { tail -60 "$B"/readline-*.log >&2; exit 1; }
  rm -f "$DEPS"/lib/pkgconfig/readline.pc "$DEPS"/lib/pkgconfig/history.pc
  # -ltinfo in Libs: configure's link test uses pkg-config without --static.
  write_pc readline 8.3 "-lreadline -ltinfo"
fi

echo "== wasix-python: deps"
ls -la "$DEPS/lib"/*.a
for pc in zlib openssl bzip2 liblzma sqlite3 readline; do
  printf '  %-9s %s | %s\n' "$pc" "$(pkg-config --modversion "$pc")" "$(pkg-config --cflags --libs --static "$pc" | sed "s#$B#\$B#g")"
done
if [[ "${HOMESCOOP_STOP_AFTER:-}" == deps ]]; then
  exit 0
fi

# --- stubs (as 3.14.2-6..-11) ------------------------------------------------
# uid/gid 1000, a passwd-less pwd/grp, no-op advisory locks, C++ TLS symbols:
# an archive, since configure lists LIBS twice.
STUBS="$B/stubs"
rm -rf "$STUBS" && mkdir -p "$STUBS"
cp "$PKG/fcntl_wasix_extra.h" "$STUBS/"
for s in uid_stubs pwd_grp_stubs lock_stubs cpp_tls_stubs; do
  # shellcheck disable=SC2086
  wasixcc $DEP_CFLAGS -I"$STUBS" -include "$STUBS/fcntl_wasix_extra.h" -c "$PKG/$s.c" -o "$STUBS/$s.o"
done
wasixar rcs "$STUBS/libpython-wasix-stubs.a" "$STUBS"/*.o
WRAP=""
for f in getuid geteuid getgid getegid getpwuid getpwnam getpwuid_r getpwnam_r getgrgid getgrnam getgrgid_r getgrnam_r flock fcntl lockf; do
  WRAP+=" -Wl,--wrap=$f"
done
for f in getuid geteuid getgid getegid flock fcntl lockf; do
  WRAP+=" -Wl,--export=__wrap_$f"
done
# cpp_tls_stubs.c: nothing in CPython references these, so pull them in and
# export them, as -11 did (python.wasm imported env._ZTH5errno and
# env.__cxa_thread_atexit_impl otherwise).
for f in _ZTH5errno __cxa_thread_atexit_impl; do
  WRAP+=" -Wl,-u,$f -Wl,--export=$f"
done

# --- CPython: patch, configure, make ------------------------------------------
SRCDIR="$B/Python-$VER"
echo "== wasix-python: CPython $VER source + patches"
rm -rf "$SRCDIR" && mkdir -p "$SRCDIR"
tar xzf "$PY_TGZ" -C "$SRCDIR" --strip-components=1
for p in cpython-configure-wasix cpython-platform-triplet-wasix cpython-user-site-wasi cpython-subprocess-posix-spawn cpython-stdout-line-buffer-nonreg; do
  patch -d "$SRCDIR" -p1 --no-backup-if-mismatch -s < "$PKG/patches/$p.patch"
  echo "  applied $p.patch"
done

PY_CFLAGS="-O3 -flto -fPIC -matomics -mbulk-memory -mmutable-globals -pthread -mthread-model posix $EMU -include $STUBS/fcntl_wasix_extra.h -ffile-prefix-map=$B=."
PY_LDFLAGS="-O3 -flto -fPIC -pthread -Wl,-pie -Wl,--export-dynamic -Wl,--shared-memory -Wl,--import-memory -Wl,--max-memory=4294967296 -Wl,--stack-first -z stack-size=16777216 -Wl,--initial-memory=41943040 -ldl -lwasi-emulated-getpid -lwasi-emulated-process-clocks -lwasi-emulated-mman"
# Cross answers configure cannot run (wasm32: little endian, no fork, no
# ptys), and probes that find a declaration WASIX does not back: the
# netpacket header (no AF_PACKET), memfd_create, and lockf (links through
# the --wrap no-op but no header declares it), all three off as on -11.
printf '%s\n' ac_cv_file__dev_ptmx=no ac_cv_file__dev_ptc=no ax_cv_c_float_words_bigendian=no \
  ac_cv_func_fork=no ac_cv_func_vfork=no \
  ac_cv_header_netpacket_packet_h=no ac_cv_func_memfd_create=no ac_cv_func_lockf=no \
  ac_cv_working_tzset=yes >"$B/config.site"
rm -rf "$CROSS" && mkdir -p "$CROSS"
(
  cd "$CROSS"
  CONFIG_SITE="$B/config.site" ../../configure \
    --host=wasm32-unknown-wasix --build="$(sh ../../config.guess)" \
    --prefix="$PREFIX_PY" --with-build-python="$HOSTPY" \
    --disable-shared --with-ensurepip=no --disable-test-modules \
    --enable-wasm-pthreads --with-pkg-config=yes \
    CC=wasixcc AR=wasixar RANLIB=wasixranlib \
    CFLAGS="$PY_CFLAGS" LDFLAGS="$PY_LDFLAGS" \
    LIBS="$STUBS/libpython-wasix-stubs.a$WRAP" \
    >"$B/configure.log" 2>&1
) || { tail -80 "$B/configure.log" >&2; exit 1; }
grep -E '^checking for stdlib extension module' "$B/configure.log" | sed 's/^checking for stdlib extension module /  module /' || true
grep -q '^SOABI=[[:space:]]*cpython-314-wasm32-wasix$' "$CROSS/Makefile" \
  || { grep '^SOABI\|^MULTIARCH' "$CROSS/Makefile" >&2; echo "homescoop wasix-python: SOABI is not cpython-314-wasm32-wasix" >&2; exit 1; }
# Every library-backed module of -11 must come from configure now.
for m in _ssl _hashlib zlib _bz2 _lzma _sqlite3 readline fcntl grp pwd mmap resource termios; do
  st="$(sed -n "s/^MODULE_${m^^}_STATE=//p" "$CROSS/Makefile")"
  [[ "$st" == yes ]] || { echo "homescoop wasix-python: module $m is '$st', not yes" >&2; exit 1; }
done

if [[ "${HOMESCOOP_STOP_AFTER:-}" == configure ]]; then
  exit 0
fi

echo "== wasix-python: make (-j$JOBS)"
make -C "$CROSS" -j"$JOBS" all >"$B/make.log" 2>&1 || { tail -80 "$B/make.log" >&2; exit 1; }
tail -25 "$B/make.log"
rm -rf "$PREFIX_PY"
make -C "$CROSS" install >"$B/install.log" 2>&1 || { tail -60 "$B/install.log" >&2; exit 1; }
test -f "$CROSS/python.wasm"

# --- asyncify + strip (as -7/-9) ----------------------------------------------
echo "== wasix-python: asyncify + strip"
ONLYLIST="fork,_fork_internal,_Fork,__wasi_proc_fork,__fork_handler,os_fork,subprocess_fork_exec,subprocess_fork_exec_impl,do_fork_exec,PyOS_BeforeFork,PyOS_AfterFork_Parent,PyOS_AfterFork_Child,PyOS_AfterFork,run_at_forkers,posix_spawn,posix_spawnp,__posix_spawn,os_posix_spawn,py_posix_spawn,os_posix_spawnp"
FEATS=(--enable-threads --enable-bulk-memory --enable-mutable-globals --enable-sign-ext --enable-nontrapping-float-to-int --enable-exception-handling)
"$WASM_OPT" --asyncify -O3 \
  --pass-arg=asyncify-imports@wasix_32v1.proc_fork,wasix_32v1.stack_checkpoint,wasix_32v1.stack_restore \
  --pass-arg=asyncify-onlylist@"$ONLYLIST" \
  --pass-arg=asyncify-ignore-indirect \
  "${FEATS[@]}" "$CROSS/python.wasm" -o "$B/python-async.wasm"
"$WASM_OPT" -O3 --strip-debug --strip-producers "${FEATS[@]}" "$B/python-async.wasm" -o "$B/python.wasm"

# --- stage ---------------------------------------------------------------------
echo "== wasix-python: stage into package/"
rm -rf "$DEST/bin" "$DEST/lib" "$DEST/include"
mkdir -p "$DEST/bin" "$DEST/lib"
cp "$B/python.wasm" "$DEST/bin/python.wasm"
chmod 755 "$DEST/bin/python.wasm"
cp -R "$PREFIX_PY/include" "$DEST/include"
cp "$PREFIX_PY/lib/libpython3.14.a" "$DEST/lib/"
cp -R "$PREFIX_PY/lib/pkgconfig" "$DEST/lib/pkgconfig"
PYLIB="$DEST/lib/python3.14"
cp -R "$PREFIX_PY/lib/python3.14" "$PYLIB"
# The same prune as 3.14.2-11.
rm -rf "$PYLIB/test" "$PYLIB/idlelib/idle_test" "$PYLIB/__phello__/ham" "$PYLIB/venv/scripts/nt" \
  "$PYLIB"/config-3.14-* "$PYLIB/site-packages"/*
find "$PYLIB" -type d -name __pycache__ -prune -exec rm -rf {} +
cp "$SRCDIR/LICENSE" "$PYLIB/LICENSE.txt"
cp "$SRCDIR/LICENSE" "$DEST/LICENSE"
# pip from the bundled ensurepip wheel, unpacked as in -11 (no INSTALLER).
PIPWHL="$(echo "$SRCDIR"/Lib/ensurepip/_bundled/pip-*.whl)"
test -f "$PIPWHL"
unzip -q -o "$PIPWHL" -d "$PYLIB/site-packages"
cp "$SRCDIR/Lib/site-packages/README.txt" "$PYLIB/site-packages/README.txt"
# slicc additions (sys.executable from PATH): stdlib modules and .pth hooks.
cp "$PKG"/stdlib/*.py "$PYLIB/"
cp "$PKG"/stdlib/site-packages/*.pth "$PYLIB/site-packages/"

# Build-machine-only values out of the sysconfig records, before compileall
# (unchecked-hash .pyc would keep the old _sysconfigdata).
python3 "$PKG/sanitize-sysconfig.py" "$PYLIB" "$B"

# Bytecode: unchecked-hash .pyc (no mtimes), by the same CPython.
echo "== wasix-python: compileall (unchecked-hash)"
"$HOSTPY" -m compileall -q -j0 --invalidation-mode unchecked-hash "$PYLIB" >/dev/null || true
"$HOSTPY" "$PKG/test/pyc-check.py" "$PYLIB"

# --- notices -------------------------------------------------------------------
{
  echo "# Third-party notices: @ai-ecoverse/wasix-python"
  echo
  echo "bin/python.wasm statically links:"
  echo
  echo "| component | version | license | source |"
  echo "| --- | --- | --- | --- |"
  echo "| CPython (incl. mpdecimal, expat, HACL*) | $VER | PSF-2.0 (LICENSE) | python.org |"
  echo "| OpenSSL | $(pkg-config --modversion openssl) | Apache-2.0 | @ai-ecoverse/wasix-openssl |"
  echo "| zlib | $(pkg-config --modversion zlib) | Zlib | @ai-ecoverse/wasix-zlib |"
  echo "| bzip2 | 1.0.8 | bzip2-1.0.6 | sourceware.org/bzip2 |"
  echo "| xz (liblzma) | $(pkg-config --modversion liblzma) | 0BSD | tukaani.org/xz |"
  echo "| SQLite | $(pkg-config --modversion sqlite3) | public domain | sqlite.org |"
  echo "| GNU Readline | 8.3 | GPL-3.0-or-later | gnu.org/software/readline |"
  echo "| ncurses (tinfo) | 6.5 | X11 | invisible-island.net/ncurses |"
  echo "| wasix-libc | wasix-sysroot $(node -p "require('$WASIXCC_SYSROOT_PREFIX/package.json').version") | Apache-2.0 WITH LLVM-exception, MIT | @ai-ecoverse/wasix-sysroot |"
  echo "| libc++, libc++abi, libunwind | wasix-libc v2026-07-03.1 sysroot-ehpic | Apache-2.0 WITH LLVM-exception | github.com/wasix-org/wasix-libc |"
  echo
  echo "lib/python3.14/site-packages/pip is pip (MIT), from CPython's ensurepip bundle."
} >"$DEST/THIRD-PARTY-NOTICES.md"

# --- checks --------------------------------------------------------------------
bash "$PKG/prestage-check.sh" "$DEST/bin/python.wasm" "$PYLIB"
# No host artefacts: native binaries, build-machine paths, host-platform wheels.
python3 "$PKG/test/staging-check.py" "$DEST"
# Every import of the published py-* side modules is exported (homescoop#181).
node "$PKG/test/side-abi.mjs" --wasm "$DEST/bin/python.wasm" --report "$B/side-abi.md"

# Config review (the perl -7 lesson): dumped for the diff against -11.
echo "== wasix-python: pyconfig.h"
grep -E '^#define ' "$DEST/include/python3.14/pyconfig.h" | sort | sed 's/^/  pyconfig: /'
echo "== wasix-python: sysconfig build_time_vars"
python3 "$PKG/test/sysconfig-dump.py" "$PYLIB"/_sysconfigdata__wasi_wasm32-wasix.py | sed 's/^/  sysconfig: /'
echo "== wasix-python: staged $(du -sh "$DEST" | awk '{print $1}')"
