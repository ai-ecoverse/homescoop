#!/usr/bin/env bash
# CPython 3.14 for slicc WASIX, cross-built from source (homescoop#181):
# a dynamic-main python.wasm on wasix-sysroot -17's sysroot-ehpic (legacy
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
# prestage-check.sh disassembles with wabt's wasm-objdump.
if ! command -v wasm-objdump >/dev/null && [[ -z "${WASM_OBJDUMP:-}" ]]; then
  if command -v apt-get >/dev/null; then
    sudo apt-get install -y -qq wabt >/dev/null
  fi
fi
command -v wasm-objdump >/dev/null || [[ -n "${WASM_OBJDUMP:-}" ]] || { echo "homescoop wasix-python: need wasm-objdump (wabt)" >&2; exit 1; }
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
    ./configure --prefix="$B/host" --without-ensurepip --disable-test-modules >"$B/host-configure.log" 2>&1
    make -j"$JOBS" >"$B/host-make.log" 2>&1
    make install >"$B/host-install.log" 2>&1
  ) || { tail -40 "$B"/host-*.log >&2; exit 1; }
fi
"$HOSTPY" -c 'import sys; assert sys.version_info[:3] == (3, 14, 2), sys.version'

# --- WASIX toolchain ---------------------------------------------------------
# Pinned wasixcc + wasix-sysroot 2025.9.30-17. sysroot-ehpic (legacy EH, PIC)
# already has the setitimer → proc_raise_interval2 and clock_nanosleep EINTR
# libc patches (patches/README.md); advisory locks are lock_stubs.c below.
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$B/wasixcc")"
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
  # Their lib-pic .pc files are relative (${pcfiledir}); link them in.
  for pc in "$d"/package/lib-pic/pkgconfig/*.pc; do
    ln -sf "$pc" "$DEPS/lib/pkgconfig/$(basename "$pc")"
  done
done
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
    -DSQLITE_ENABLE_MATH_FUNCTIONS -DSQLITE_ENABLE_RTREE -DSQLITE_DEFAULT_AUTOVACUUM \
    -DSQLITE_DEFAULT_RECURSIVE_TRIGGERS -DSQLITE_DISABLE_LFS \
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
    ./configure --host="$CROSS_HOST" --build="$(./config.guess)" --prefix="$DEPS" \
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
    export bash_cv_termcap_lib=libtinfo bash_cv_func_sigsetjmp=present \
      bash_cv_func_strcoll_broken=no bash_cv_must_reinstall_sighandlers=no \
      bash_cv_func_ctype_nonascii=no bash_cv_dup2_broken=no \
      bash_cv_getpw_declared=yes bash_cv_void_sighandler=yes
    ./configure --host="$CROSS_HOST" --build="$(./support/config.guess)" --prefix="$DEPS" \
      --disable-shared --enable-static --with-curses --disable-install-examples \
      CC=wasixcc CFLAGS="$DEP_CFLAGS" CPPFLAGS="-I$DEPS/include" LDFLAGS="-L$DEPS/lib" \
      >"$B/readline-configure.log" 2>&1
    make -j"$JOBS" static >"$B/readline-make.log" 2>&1
    make install-static install-headers >>"$B/readline-make.log" 2>&1
  ) || { tail -60 "$B"/readline-*.log >&2; exit 1; }
  rm -f "$DEPS"/lib/pkgconfig/readline.pc "$DEPS"/lib/pkgconfig/history.pc
  write_pc readline 8.3 -lreadline tinfo
fi

echo "== wasix-python: deps"
ls -la "$DEPS/lib"/*.a
for pc in zlib openssl bzip2 liblzma sqlite3 readline; do
  printf '  %-9s %s | %s\n' "$pc" "$(pkg-config --modversion "$pc")" "$(pkg-config --cflags --libs --static "$pc" | sed "s#$B#\$B#g")"
done
if [[ "${HOMESCOOP_STOP_AFTER:-}" == deps ]]; then
  exit 0
fi

echo "homescoop wasix-python: cross-build steps after deps not written yet" >&2
exit 1
