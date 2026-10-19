#!/usr/bin/env bash
# CPython for slicc WASIX (the major.minor of recipe.yaml's version), cross-built from source (homescoop#181):
# a dynamic-main python.wasm on the pinned wasix-sysroot's sysroot-ehpic (legacy
# wasm EH, PIC; side modules load by dlopen), with its stdlib.
#
# Steps: host CPython $VER (the build python, from the same tarball) →
# static PIC deps (bzip2, xz, sqlite, ncurses tinfo, readline, libffi; zlib
# and OpenSSL from the wasix-zlib / wasix-openssl dev packages) → configure +
# make (modules found by configure via pkg-config) → asyncify + strip →
# stage, prune, pip, compileall → checks.
#
# Everything is built under a fixed root (WASIX_PYTHON_BUILD_ROOT, default
# /tmp/homescoop-<recipe dir>), so the paths in _sysconfigdata and the
# tarball do not depend on the runner's checkout. HOMESCOOP_STOP_AFTER=deps
# stops after the dependencies (a small local probe).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=../../scripts/build-common.sh
source "$ROOT/scripts/build-common.sh"
# The recipe is this directory: wasix-python, or wasix-python while the
# 3.15 wave publishes under its npm-tag beside the 3.14 dir.
RECIPE="$(basename "$(cd "$(dirname "$0")" && pwd)")"
homescoop_load_recipe "$RECIPE"

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="${WASIX_PYTHON_BUILD_ROOT:-/tmp/homescoop-$RECIPE}"
DL="$B/dl"
DEPS="$B/deps"
CROSS="$B/Python-$VER/cross-build/wasm32-wasix"
PREFIX_PY="$B/prefix"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
# PYV is the major.minor (3.15), PYVN the same without the dot (315): the
# lib/pythonX.Y paths, libpythonX.Y.a and the SOABI cpython-XY-wasm32-wasix.
PYV="${VER%.*}"
PYVN="${PYV/./}"
export PYTHONHASHSEED=0
export ZERO_AR_DATE=1
DEPS_KEY="$(cat "$PKG/build.sh" "$ROOT/scripts/install-wasixcc.sh" | shasum -a 256 | cut -d' ' -f1)"
if [[ -d "$DEPS" && "$(cat "$DEPS/.homescoop-key" 2>/dev/null)" != "$DEPS_KEY" ]]; then
  echo "== wasix-python: build.sh or the toolchain pin changed since $DEPS was built; rebuilding the deps"
  rm -rf "$DEPS"
fi
mkdir -p "$B" "$DL" "$DEPS/lib/pkgconfig" "$DEPS/include"
echo "$DEPS_KEY" >"$DEPS/.homescoop-key"

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
  homescoop_load_recipe "$RECIPE" --source "$name"
  url_var="${name^^}_SRC_URL"; sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe "$RECIPE"
PY_TGZ="$DL/Python-$VER.tgz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$PY_TGZ"
# __DATE__/__TIME__ (sys.version) and archive mtimes: the release date in
# the tarball's Misc/NEWS (3.14.2: 2025-12-05, 1764892800).
SOURCE_DATE_EPOCH="$(tar xzOf "$PY_TGZ" "Python-$VER/Misc/NEWS" | python3 -c '
import datetime, re, sys
m = re.search(r"^\*Release date: (\d{4}-\d\d-\d\d)\*$", sys.stdin.read(), re.M)
print(int(datetime.datetime.strptime(m[1], "%Y-%m-%d").replace(tzinfo=datetime.timezone.utc).timestamp()))')"
export SOURCE_DATE_EPOCH
echo "== wasix-python: CPython $VER ($PYV, SOABI cpython-$PYVN-wasm32-wasix), SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH"

# --- host CPython (the build python) ------------------------------------------
HOSTPY="$B/host/bin/python$PYV"
if [[ ! -x "$HOSTPY" ]]; then
  echo "== wasix-python: host CPython $VER"
  rm -rf "$B/host-src" && mkdir -p "$B/host-src"
  tar xzf "$PY_TGZ" -C "$B/host-src" --strip-components=1
  (
    cd "$B/host-src"
    unset CC CFLAGS LDFLAGS CPPFLAGS
    # Only a build python (freeze, compileall): no host OpenSSL, whose
    # pick-up varies by machine (a Homebrew 3.x mismatch fails sharedinstall).
    ./configure --prefix="$B/host" --without-ensurepip --disable-test-modules --with-system-libmpdec=no \
      py_cv_module__ssl=n/a py_cv_module__hashlib=n/a >"$B/host-configure.log" 2>&1
    make -j"$JOBS" >"$B/host-make.log" 2>&1
    make install >"$B/host-install.log" 2>&1
  ) || { tail -40 "$B"/host-*.log >&2; exit 1; }
fi
"$HOSTPY" -c 'import platform, sys; assert platform.python_version() == sys.argv[1], (sys.version, sys.argv[1])' "$VER"

# --- WASIX toolchain ---------------------------------------------------------
# Pinned wasixcc + wasix-sysroot: 3.15.0-1 takes -38 through the per-recipe
# override (-37's Linux S_IF* bits, -38's poll; install-wasixcc.sh's default
# is still -34). sysroot-ehpic (legacy EH, PIC) has the setitimer →
# proc_raise_interval2 and clock_nanosleep EINTR libc patches
# (patches/README.md); flock, fcntl record locks and lockf are libc's.
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-38
export HOMESCOOP_WASIX_SYSROOT_SHA=1fb57c95d84e7b33a5a535561a0d536c943c40fefd70991f9570db8e27994574
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$B/wasixcc")"
# C++ runtime ABI of the side modules (README "Side modules"): py-*
# extensions import _Unwind_CallPersonality, __cxa_thread_atexit and a plain
# (not thread_local) __wasm_lpad_context from python.wasm. Up to 3.14.2-28
# python linked upstream wasix-libc v2026-07-03.1's sysroot-ehpic runtimes
# for that; since 3.15.0-1 (#211 phase B) it links the pinned sysroot's own:
# -38's libc++/libc++abi/libunwind define the same globals (llvm 6bb93a24,
# include/c++ byte-identical, cc7e's measurement on #1138). The checks below
# keep a later sysroot from changing that ABI silently.
EHPIC_LIB="$WASIXCC_SYSROOT_PREFIX/sysroot-ehpic/lib/wasm32-wasip1"
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
"$LLVM_NM" --defined-only -j "$EHPIC_LIB/libc++abi.a" 2>/dev/null | grep -qx __cxa_thread_atexit \
  || { echo "homescoop wasix-python: libc++abi lacks __cxa_thread_atexit (side-module ABI)" >&2; exit 1; }
"$LLVM_NM" --defined-only "$EHPIC_LIB/libunwind.a" 2>/dev/null | grep -q ' D __wasm_lpad_context$' \
  || { echo "homescoop wasix-python: libunwind's __wasm_lpad_context is not plain data (side-module ABI)" >&2; exit 1; }
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
    -DSQLITE_DEFAULT_RECURSIVE_TRIGGERS=0 -DSQLITE_DISABLE_LFS -DSQLITE_DEFAULT_UNIX_VFS='"unix"' \
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

# --- deps: libffi (ctypes; wasix-org wasm32 WASIX backend) --------------------
# Homescoop#110 / slicc-kernel#306: wasix_call_dynamic + closure_*.
# GitHub archive has no configure; autogen needs host autoconf/automake/libtool.
if [[ ! -f "$DEPS/lib/libffi.a" ]]; then
  echo "== wasix-python: libffi (ctypes)"
  fetch_src libffi
  rm -rf "$B/libffi-src" && mkdir -p "$B/libffi-src"
  tar xzf "$SRC_FILE" -C "$B/libffi-src" --strip-components=1
  # 3.14.2-16: variadic calls on the WASIX backend (ffi_prep_cif_var
  # returned FFI_BAD_ABI): patches/libffi-wasix-varargs.patch.
  patch -d "$B/libffi-src" -p1 --no-backup-if-mismatch -s < "$PKG/patches/libffi-wasix-varargs.patch"
  if [[ ! -f "$B/libffi-src/configure" ]]; then
    # macOS Homebrew: libtoolize lives under libtool's gnubin.
    if [[ -d /opt/homebrew/opt/libtool/libexec/gnubin ]]; then
      export PATH="/opt/homebrew/opt/libtool/libexec/gnubin:/opt/homebrew/opt/autoconf/bin:/opt/homebrew/opt/automake/bin:$PATH"
    fi
    # Ubuntu's libtoolize is present without ltdl.m4 (LT_SYS_SYMBOL_USCORE);
    # that macro lives in libltdl-dev. Install the full set whenever CI has apt,
    # even if autoreconf/libtoolize are already on PATH.
    if [[ -n "${CI:-}" ]] && command -v apt-get >/dev/null; then
      sudo apt-get update -qq
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        autoconf automake libtool libltdl-dev
    fi
    command -v autoreconf >/dev/null && command -v libtoolize >/dev/null \
      || { echo "homescoop wasix-python: need autoconf, automake, libtool (libffi autogen)" >&2; exit 1; }
    # Soft check: warn if ltdl.m4 is still missing (macOS Homebrew libtool has it).
    if command -v aclocal >/dev/null; then
      _acdir=$(aclocal --print-ac-dir 2>/dev/null || true)
      if [[ -n "$_acdir" && ! -f "$_acdir/ltdl.m4" ]]; then
        echo "homescoop wasix-python: missing $_acdir/ltdl.m4 (LT_SYS_SYMBOL_USCORE); install libltdl-dev" >&2
        exit 1
      fi
      unset _acdir
    fi
    (cd "$B/libffi-src" && ./autogen.sh) >"$B/libffi-autogen.log" 2>&1 \
      || { tail -40 "$B/libffi-autogen.log" >&2; exit 1; }
  fi
  rm -rf "$B/libffi" && mkdir -p "$B/libffi"
  (
    cd "$B/libffi"
    # wasix host so src/wasm32/ffi.c takes the non-Emscripten wasix_* path.
    "$B/libffi-src/configure" --host=wasm32-unknown-wasix \
      --build="$(sh "$B/libffi-src/config.guess")" \
      --prefix="$DEPS" --disable-shared --enable-static \
      --disable-docs --disable-multi-os-directory \
      CC=wasixcc CFLAGS="$DEP_CFLAGS" >"$B/libffi-configure.log" 2>&1
    make -j"$JOBS" >"$B/libffi-make.log" 2>&1
    make install >>"$B/libffi-make.log" 2>&1
  ) || { tail -60 "$B"/libffi-*.log >&2; exit 1; }
  rm -f "$DEPS"/lib/libffi.la
  test -f "$DEPS/include/ffi.h"
  write_pc libffi 3.5.1 -lffi
fi

echo "== wasix-python: deps"
ls -la "$DEPS/lib"/*.a
for pc in zlib openssl bzip2 liblzma sqlite3 readline libffi; do
  printf '  %-9s %s | %s\n' "$pc" "$(pkg-config --modversion "$pc")" "$(pkg-config --cflags --libs --static "$pc" | sed "s#$B#\$B#g")"
done
if [[ "${HOMESCOOP_STOP_AFTER:-}" == deps ]]; then
  exit 0
fi

# --- stubs ---------------------------------------------------------------------
# C++ TLS symbols: an archive, since configure lists LIBS twice. flock is
# libc's since 3.14.2-26 (wasix-sysroot -34, slicc.flock); -11 to -25 wrapped
# it to a no-op here (lock_stubs.c). Since 3.14.2-13 user and group ids and pwd/grp come from
# wasix-sysroot -20's libc (slicc-kernel process credentials, /etc/passwd;
# homescoop#207), not uid/gid-1000 stubs.
STUBS="$B/stubs"
rm -rf "$STUBS" && mkdir -p "$STUBS"
cp "$PKG/fcntl_wasix_extra.h" "$STUBS/"
for s in cpp_tls_stubs; do
  # shellcheck disable=SC2086
  wasixcc $DEP_CFLAGS -I"$STUBS" -include "$STUBS/fcntl_wasix_extra.h" -c "$PKG/$s.c" -o "$STUBS/$s.o"
done
wasixar rcs "$STUBS/libpython-wasix-stubs.a" "$STUBS"/*.o
WRAP=""
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
for p in cpython-configure-wasix cpython-platform-triplet-wasix cpython-user-site-wasi cpython-subprocess-posix-spawn cpython-stdout-line-buffer-nonreg cpython-ensurepip-installed-pip cpython-multiprocessing-wasix cpython-multiprocessing-util-wasix cpython-multiprocessing-noshare-wasix cpython-multiprocessing-unix-listener-wasix cpython-thread-native-id-wasix cpython-fork-hint-wasix; do
  patch -d "$SRCDIR" -p1 -F0 --no-backup-if-mismatch -s < "$PKG/patches/$p.patch"
  echo "  applied $p.patch"
done

PY_CFLAGS="-O3 -flto -fPIC -matomics -mbulk-memory -mmutable-globals -pthread -mthread-model posix $EMU -include $STUBS/fcntl_wasix_extra.h -ffile-prefix-map=$B=."
PY_LDFLAGS="-O3 -flto -fPIC -pthread -Wl,-pie -Wl,--export-dynamic -Wl,--shared-memory -Wl,--import-memory -Wl,--max-memory=4294967296 -Wl,--stack-first -z stack-size=16777216 -Wl,--initial-memory=41943040 -ldl -lwasi-emulated-getpid -lwasi-emulated-process-clocks -lwasi-emulated-mman"
# Cross answers configure cannot run (wasm32: little endian, no fork, no
# ptys), and probes that find a declaration WASIX does not back: the
# netpacket header (no AF_PACKET) and memfd_create, both off as on -11.
printf '%s\n' ac_cv_file__dev_ptmx=no ac_cv_file__dev_ptc=no ax_cv_c_float_words_bigendian=no \
  ac_cv_func_fork=no ac_cv_func_vfork=no \
  ac_cv_header_netpacket_packet_h=no ac_cv_func_memfd_create=no \
  ac_cv_working_tzset=yes >"$B/config.site"
# CPython 3.15's configure no longer has a default HOSTRUNNER for WASI (3.14
# picked this wasmtime line). Only `make pythoninfo`/the tests use it, so
# 3.14's value stays, and sysconfig keeps recording the same HOSTRUNNER.
# CXX: 3.15's configure records the host clang++ by absolute path (3.14 kept
# the bare name, which sanitize-sysconfig.py rewrote to wasix++), so it's
# set: sysconfig's CXX/LDCXXSHARED are wasix++ as before.
WASI_HOSTRUNNER='wasmtime run --wasm max-wasm-stack=16777216 --wasi preview2=n --env PYTHONPATH=/$(shell realpath --relative-to $(abs_srcdir) $(abs_builddir))/$(shell cat pybuilddir.txt):/Lib --dir $(srcdir)::/'
configure_python() {
  local dir=$1 site=$2 prefix=$3
  rm -rf "$dir" && mkdir -p "$dir"
  (
    cd "$dir"
    CONFIG_SITE="$site" HOSTRUNNER="$WASI_HOSTRUNNER" ../../configure \
      --host=wasm32-unknown-wasix --build="$(sh ../../config.guess)" \
      --prefix="$prefix" --with-build-python="$HOSTPY" \
      --disable-shared --with-ensurepip=no --disable-test-modules \
      --enable-wasm-pthreads --with-pkg-config=yes --with-system-ffi --with-system-libmpdec=no \
      CC=wasixcc CXX=wasix++ AR=wasixar RANLIB=wasixranlib \
      CFLAGS="$PY_CFLAGS" LDFLAGS="$PY_LDFLAGS" \
      LIBS="$STUBS/libpython-wasix-stubs.a$WRAP" \
      >"$dir/configure.log" 2>&1
  ) || { tail -80 "$dir/configure.log" >&2; exit 1; }
}
configure_python "$CROSS" "$B/config.site" "$PREFIX_PY"
cp "$CROSS/configure.log" "$B/configure.log"
grep -E '^checking for stdlib extension module' "$B/configure.log" | sed 's/^checking for stdlib extension module /  module /' || true
grep -q "^SOABI=[[:space:]]*cpython-$PYVN-wasm32-wasix\$" "$CROSS/Makefile" \
  || { grep '^SOABI\|^MULTIARCH' "$CROSS/Makefile" >&2; echo "homescoop wasix-python: SOABI is not cpython-$PYVN-wasm32-wasix" >&2; exit 1; }
# Every library-backed module of -11 must come from configure now, plus
# _ctypes; _decimal and pyexpat from CPython's bundled mpdecimal and expat
# (3.15 no longer falls back to the bundled mpdecimal by itself).
for m in _ssl _hashlib zlib _bz2 _lzma _sqlite3 readline fcntl grp pwd mmap resource termios _ctypes _multiprocessing _posixshmem _decimal pyexpat; do
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
node "$PKG/drop-exports.mjs" "$B/python.wasm" fork _Fork _fork_internal __vfork_internal __wasi_proc_fork __wasi_proc_fork_env


echo "== wasix-python: the fork build (HAVE_FORK, full asyncify; PYTHON_FORK=true, homescoop#357)"
CROSS_FORK="$B/Python-$VER/cross-build/wasm32-wasix-fork"
sed '/^ac_cv_func_fork=no$/d' "$B/config.site" >"$B/config-fork.site"
configure_python "$CROSS_FORK" "$B/config-fork.site" "$B/prefix-fork"
grep -q '^#define HAVE_FORK 1$' "$CROSS_FORK/pyconfig.h" || { echo "homescoop wasix-python: the fork build has no HAVE_FORK" >&2; exit 1; }
! grep -q '^#define HAVE_FORK 1$' "$CROSS/pyconfig.h" || { echo "homescoop wasix-python: the default build has HAVE_FORK" >&2; exit 1; }
make -C "$CROSS_FORK" -j"$JOBS" all >"$B/make-fork.log" 2>&1 || { tail -80 "$B/make-fork.log" >&2; exit 1; }
test -f "$CROSS_FORK/python.wasm"
"$WASM_OPT" --asyncify -O3 \
  --pass-arg=asyncify-imports@wasix_32v1.proc_fork,wasix_32v1.stack_checkpoint,wasix_32v1.stack_restore \
  "${FEATS[@]}" "$CROSS_FORK/python.wasm" -o "$B/python-fork-async.wasm"
"$WASM_OPT" -O3 --strip-debug --strip-producers "${FEATS[@]}" "$B/python-fork-async.wasm" -o "$B/python-fork.wasm"
node "$PKG/drop-exports.mjs" "$B/python-fork.wasm" fork _Fork _fork_internal __vfork_internal __wasi_proc_fork __wasi_proc_fork_env

# --- stage ---------------------------------------------------------------------
echo "== wasix-python: stage into package/"
rm -rf "$DEST/bin" "$DEST/lib" "$DEST/include"
mkdir -p "$DEST/bin" "$DEST/lib"
cp "$B/python.wasm" "$DEST/bin/python.wasm"
cp "$B/python-fork.wasm" "$DEST/bin/python-fork.wasm"
chmod 755 "$DEST/bin/python.wasm" "$DEST/bin/python-fork.wasm"
cp -R "$PREFIX_PY/include" "$DEST/include"
cp "$PREFIX_PY/lib/libpython$PYV.a" "$DEST/lib/"
cp -R "$PREFIX_PY/lib/pkgconfig" "$DEST/lib/pkgconfig"
PYLIB="$DEST/lib/python$PYV"
cp -R "$PREFIX_PY/lib/python$PYV" "$PYLIB"
# The same prune as 3.14.2-11.
rm -rf "$PYLIB/test" "$PYLIB/idlelib/idle_test" "$PYLIB/__phello__/ham" "$PYLIB/venv/scripts/nt" \
  "$PYLIB"/config-"$PYV"-* "$PYLIB/site-packages"/*
find "$PYLIB" -type d -name __pycache__ -prune -exec rm -rf {} +
# CPython 3.15's getpath warns on every start ("Could not find the platform
# standard library directory!") when PYTHONHOME is set and lib-dynload is
# missing, and npm drops empty directories: every module is built into
# python.wasm, so lib-dynload gets a README instead.
mkdir -p "$PYLIB/lib-dynload"
printf '%s\n' "The standard library's extension modules are built into bin/python.wasm, so this directory has none." \
  "py-* packages bring their own side modules (slicc.python.sitePackages)." >"$PYLIB/lib-dynload/README.txt"
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
NOTICES="$B/notices"
rm -rf "$NOTICES" && mkdir -p "$NOTICES"
notice_file() {
  local archive=$1 member=$2 out
  out="$NOTICES/$(basename "$archive")-${member//\//_}"
  case "$archive" in
    *.zip) unzip -p "$archive" "$member" ;;
    *.tar.xz) tar xJOf "$archive" "$member" ;;
    *) tar xzOf "$archive" "$member" ;;
  esac >"$out"
  test -s "$out" || { echo "homescoop wasix-python: no $member in $archive" >&2; return 1; }
  printf '%s' "$out"
}
top_dir() {
  case "$1" in
    *.zip) unzip -Z1 "$1" ;;
    *.tar.xz) tar tJf "$1" ;;
    *) tar tzf "$1" ;;
  esac | awk -F/ 'NR == 1 { print $1 }'
}
CPY_LICENSES="$NOTICES/cpython-incorporated.rst"
tar xzOf "$PY_TGZ" "Python-$VER/Doc/license.rst" | sed -n '/^Licenses and Acknowledgements for Incorporated Software$/,$p' >"$CPY_LICENSES.src"
# 3.15's license.rst pulls expat's notice in with `.. literalinclude::
# ../Modules/expat/COPYING` instead of inlining it (homescoop#1146): every
# include is resolved from the same tarball, and none may be left.
python3 - "$PY_TGZ" "Python-$VER" "$CPY_LICENSES.src" >"$CPY_LICENSES" <<'PY'
import re, sys, tarfile
tgz, top, src = sys.argv[1:4]
lines = open(src, encoding="utf-8").read().split("\n")
out, i = [], 0
with tarfile.open(tgz) as t:
    while i < len(lines):
        m = re.match(r"^\.\. literalinclude:: \.\./(\S+)$", lines[i])
        if not m:
            out.append(lines[i])
            i += 1
            continue
        i += 1
        while i < len(lines) and re.match(r"^\s+:[\w-]+:", lines[i]):
            i += 1
        out.append(t.extractfile(f"{top}/{m[1]}").read().decode("utf-8").rstrip("\n"))
text = "\n".join(out)
if re.search(r"^\s*\.\. (literalinclude|include)::", text, re.M):
    sys.exit("homescoop wasix-python: Doc/license.rst still has an include directive")
sys.stdout.write(text)
PY
rm -f "$CPY_LICENSES.src"
test -s "$CPY_LICENSES"
grep -q 'Clark Cooper' "$CPY_LICENSES" || { echo "homescoop wasix-python: no expat notice in the CPython licences" >&2; exit 1; }
CPY_HACL="$NOTICES/cpython-hacl.txt"
tar xzOf "$PY_TGZ" "Python-$VER/Modules/_hacl/Hacl_Hash_SHA2.c" | sed -n '1,/\*\//p' >"$CPY_HACL"
grep -q 'MIT License' "$CPY_HACL"
fetch_src bzip2; BZ2_TB="$SRC_FILE"
fetch_src xz; XZ_TB="$SRC_FILE"
fetch_src sqlite; SQ_ZIP="$SRC_FILE"
fetch_src readline; RL_TB="$SRC_FILE"
fetch_src ncurses; NC_TB="$SRC_FILE"
fetch_src libffi; FFI_TB="$SRC_FILE"
SQ_BLESSING="$NOTICES/sqlite-blessing.txt"
unzip -p "$SQ_ZIP" "$(top_dir "$SQ_ZIP")/sqlite3.h" | sed -n '1,/May you share freely/p' >"$SQ_BLESSING"
grep -q 'disclaims copyright' "$SQ_BLESSING"
SYSROOT_PKG_VER="$(node -p "require('$WASIXCC_SYSROOT_PREFIX/package.json').version")"
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2026-07-03.1
LLVM_SRC=https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-20.1.0
WORK="$B" homescoop_notices_begin "bin/python.wasm statically links the components below. The table lists them; each section after it has the component's licence text."
{
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
  echo "| libffi | $(pkg-config --modversion libffi) (wasix-org 09cbf7d + patches/libffi-wasix-varargs.patch) | MIT | github.com/wasix-org/libffi |"
  echo "| wasix-libc | wasix-sysroot $SYSROOT_PKG_VER | Apache-2.0 WITH LLVM-exception, MIT | @ai-ecoverse/wasix-sysroot |"
  echo "| libc++, libc++abi, libunwind | wasix-sysroot $SYSROOT_PKG_VER sysroot-ehpic | Apache-2.0 WITH LLVM-exception | @ai-ecoverse/wasix-sysroot |"
  echo
  echo "GNU Readline is licensed under the GPL-3.0-or-later and is linked statically, so bin/python.wasm as a whole (a combined work with CPython, whose PSF-2.0 licence is GPL-compatible, and the other components above, all under GPL-compatible licences) is distributed under the terms of the GPL-3.0-or-later; hence the package licence PSF-2.0 AND GPL-3.0-or-later. Redistributors pass on its Corresponding Source: the homescoop repository (https://github.com/ai-ecoverse/homescoop) at the commit this release was built from, plus the sha256-pinned upstream archives and dev packages its recipe.yaml lists, which homescoop keeps available."
  echo
  echo "lib/python$PYV/site-packages/pip is pip (MIT), from CPython's ensurepip bundle; its licence is in its dist-info."
} >>"$HOMESCOOP_NOTICES"
homescoop_notice "CPython $VER: incorporated software (Doc/license.rst)" "$CPY_LICENSES" - "$CPY_HACL" -
homescoop_notice "OpenSSL $(pkg-config --modversion openssl) (@ai-ecoverse/wasix-openssl), Apache-2.0" "$DEPS/wasix-openssl/package/LICENSE" -
homescoop_notice "zlib $(pkg-config --modversion zlib) (@ai-ecoverse/wasix-zlib), Zlib" "$DEPS/wasix-zlib/package/LICENSE" -
homescoop_notice "bzip2 1.0.8" "$(notice_file "$BZ2_TB" "$(top_dir "$BZ2_TB")/LICENSE")" -
homescoop_notice "xz $(pkg-config --modversion liblzma) (liblzma), 0BSD" "$(notice_file "$XZ_TB" "$(top_dir "$XZ_TB")/COPYING")" - "$(notice_file "$XZ_TB" "$(top_dir "$XZ_TB")/COPYING.0BSD")" -
homescoop_notice "SQLite $(pkg-config --modversion sqlite3), public domain" "$SQ_BLESSING" -
homescoop_notice "GNU Readline 8.3, GPL-3.0-or-later" "$(notice_file "$RL_TB" "$(top_dir "$RL_TB")/COPYING")" -
homescoop_notice "ncurses 6.5 (tinfo), X11" "$(notice_file "$NC_TB" "$(top_dir "$NC_TB")/COPYING")" -
homescoop_notice "libffi $(pkg-config --modversion libffi) (wasix-org 09cbf7d), MIT" "$(notice_file "$FFI_TB" "$(top_dir "$FFI_TB")/LICENSE")" -
WORK="$B" homescoop_notice "wasix-libc (@ai-ecoverse/wasix-sysroot $SYSROOT_PKG_VER; files from tag v2026-07-03.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af \
  "$WLIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0
WORK="$B" homescoop_notice "libc++, libc++abi, libunwind (@ai-ecoverse/wasix-sysroot $SYSROOT_PKG_VER sysroot-ehpic; licence files from llvm-project llvmorg-20.1.0)" \
  "$LLVM_SRC/libcxx/LICENSE.TXT" 539dd7aed86e8a4f12cbdd0e6c50c189c7d74847e4fecc64ce2c6ee3a01da38b \
  "$LLVM_SRC/libcxxabi/LICENSE.TXT" e2b35be49f7284a45b7baca8fc7b3ab7440e7902392b2528a457816b5bb2a15c \
  "$LLVM_SRC/libunwind/LICENSE.TXT" b5efebcaca80879234098e52d1725e6d9eb8fb96a19fce625d39184b705f7b6d

# --- checks --------------------------------------------------------------------
bash "$PKG/prestage-check.sh" "$DEST/bin/python.wasm" "$PYLIB"
bash "$PKG/prestage-check.sh" "$DEST/bin/python-fork.wasm" "$PYLIB"
# No host artefacts: native binaries, build-machine paths, host-platform wheels.
python3 "$PKG/test/staging-check.py" "$DEST"
# Every import of the published py-* side modules is exported (homescoop#181).
node "$PKG/test/side-abi.mjs" --wasm "$DEST/bin/python.wasm" --soabi "cpython-$PYVN-wasm32-wasix" --report "$B/side-abi.md"
node "$PKG/test/side-abi.mjs" --wasm "$DEST/bin/python-fork.wasm" --soabi "cpython-$PYVN-wasm32-wasix" --report "$B/side-abi-fork.md"

# Config review (the perl -7 lesson): dumped for the diff against -11.
echo "== wasix-python: pyconfig.h"
grep -E '^#define ' "$DEST/include/python$PYV/pyconfig.h" | sort | sed 's/^/  pyconfig: /'
echo "== wasix-python: sysconfig build_time_vars"
python3 "$PKG/test/sysconfig-dump.py" "$PYLIB"/_sysconfigdata__wasi_wasm32-wasix.py | sed 's/^/  sysconfig: /'
echo "== wasix-python: staged $(du -sh "$DEST" | awk '{print $1}')"
