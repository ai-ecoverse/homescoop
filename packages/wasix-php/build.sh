#!/usr/bin/env bash
# Cross-build PHP 8.5 (the CLI SAPI) for slicc WASIX via wasixcc.
#
# - PHP's own configure, --host=wasm32-unknown-wasi, static-main on the
#   asyncify sysroot (no wasm exceptions, no PIC), then wasm-opt --asyncify
#   for WASIX fork (pcntl_fork) and setjmp (zend_try / zend_bailout).
# - zlib and OpenSSL from the published wasix-zlib / wasix-openssl dev
#   packages; libxml2 and SQLite built here as static archives.
# - patches/*.patch, in order (each one's header says why).
# Stages bin/php.wasm, LICENSE, licenses/, patches/, SOURCES.md and
# THIRD-PARTY-NOTICES.md.
set -euo pipefail

HOMESCOOP_ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=/dev/null
source "$HOMESCOOP_ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-php
homescoop_load_recipe wasix-php --source wasix_zlib
homescoop_load_recipe wasix-php --source wasix_openssl
homescoop_load_recipe wasix-php --source libxml2
homescoop_load_recipe wasix-php --source sqlite

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
VER="$VERSION"
# The packaging revision is the committed package.json's (ruby/bind rule).
PKG_VER="$(node -p "require('$DEST/package.json').version")"
[[ "$PKG_VER" == "$VER-"* ]] || { echo "homescoop wasix-php: package.json version $PKG_VER is not $VER-N" >&2; exit 1; }
WORK="${WASIX_PHP_WORK:-$PKG/work}"
SRCS="$WORK/src"
BUILD="$WORK/build"
DEPS="$WORK/deps"
SRC="$BUILD/php-$VER"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"
ZLIB_PREFIX="$DEPS/wasix-zlib/package"
OPENSSL_PREFIX="$DEPS/wasix-openssl/package"

# wasix-sysroot -43 (install-wasixcc's default is older): -40's dlmalloc uses
# the initial memory (recipe.yaml wasm.initial-memory), -41/-43 relative paths
# through the cwd descriptor. Literal values, so cert-review's input rule can
# read them; they must match the recipe's toolchain.wasix_sysroot.
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-43
export HOMESCOOP_WASIX_SYSROOT_SHA=e5ecaf322715916aa0f2fc5cc873ead73e9258b13b22aac9ffc9660c9a1e3668
field() { node "$HOMESCOOP_ROOT/scripts/read-recipe.mjs" wasix-php --field "$1"; }
[[ "$HOMESCOOP_WASIX_SYSROOT_VERSION" == "$(field toolchain.wasix_sysroot)" && "$HOMESCOOP_WASIX_SYSROOT_SHA" == "$(field toolchain.wasix_sysroot_sha256)" ]] \
  || { echo "homescoop wasix-php: build.sh's wasix-sysroot pin isn't recipe.yaml's toolchain.wasix_sysroot" >&2; exit 1; }
eval "$(bash "$HOMESCOOP_ROOT/scripts/install-wasixcc.sh" "${WASIX_PHP_WASIXCC:-$WORK/wasixcc-$HOMESCOOP_WASIX_SYSROOT_VERSION}")"
SYSROOT_VER="$(node -p "require(process.argv[1]).version" "$WASIXCC_SYSROOT_PREFIX/package.json")"
[[ "$SYSROOT_VER" == "$HOMESCOOP_WASIX_SYSROOT_VERSION" ]] || { echo "homescoop wasix-php: installed wasix-sysroot $SYSROOT_VER, not $HOMESCOOP_WASIX_SYSROOT_VERSION" >&2; exit 1; }
WASM_OPT="${WASIXCC_BINARYEN_LOCATION}/bin/wasm-opt"
export PATH="${WASIXCC_PREFIX}/bin:${WASIXCC_LLVM_LOCATION}/bin:$PATH"
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS=no
export WASIXCC_PIC=no
export WASIXCC_MODULE_KIND=static-main
export ZERO_AR_DATE=1
unset CFLAGS CPPFLAGS LDFLAGS CXX CXXFLAGS LIBS VIRTUAL_ENV
command -v wasixcc >/dev/null
test -x "$WASM_OPT"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) BUILD_TRIPLE=aarch64-apple-darwin ;;
  Darwin-x86_64) BUILD_TRIPLE=x86_64-apple-darwin ;;
  Linux-x86_64) BUILD_TRIPLE=x86_64-pc-linux-gnu ;;
  Linux-aarch64) BUILD_TRIPLE=aarch64-unknown-linux-gnu ;;
  *) echo "homescoop wasix-php: unsupported build host $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
HOST_TRIPLE=wasm32-unknown-wasi

# Every C file sees the same flags: wasi-libc's emulations (process clocks,
# getpid, signal, mman) and the build tree mapped to ".", so no build path
# reaches the wasm (__FILE__) and a rebuild elsewhere gives the same bytes.
EMU_CPPFLAGS="-D_GNU_SOURCE -D_WASI_EMULATED_PROCESS_CLOCKS -D_WASI_EMULATED_GETPID -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_MMAN"
EMU_LIBS="-lwasi-emulated-getpid -lwasi-emulated-process-clocks -lwasi-emulated-mman"
DEP_CFLAGS="-O2 -ffile-prefix-map=$WORK=. $EMU_CPPFLAGS"

# WASIX_PHP_REUSE=1 keeps a finished build tree and only stages (local
# iteration on the package; CI always builds from scratch).
REUSE=""
[[ -n "${WASIX_PHP_REUSE:-}" && -f "$SRC/sapi/cli/php" ]] && REUSE=1
[[ -n "$REUSE" ]] || rm -rf "$BUILD" "$DEPS"
mkdir -p "$SRCS" "$BUILD" "$DEPS/lib/pkgconfig" "$DEPS/include" "$DEPS/wasix-zlib" "$DEPS/wasix-openssl"

PHP_TB="$SRCS/php-$VER.tar.xz"
XML_TB="$SRCS/libxml2-$LIBXML2_VERSION.tar.xz"
SQ_ZIP="$SRCS/$(basename "$SQLITE_SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$PHP_TB"
homescoop_fetch "$WASIX_ZLIB_SRC_URL" "$WASIX_ZLIB_SRC_SHA" "$SRCS/wasix-zlib.tgz"
homescoop_fetch "$WASIX_OPENSSL_SRC_URL" "$WASIX_OPENSSL_SRC_SHA" "$SRCS/wasix-openssl.tgz"
homescoop_fetch "$LIBXML2_SRC_URL" "$LIBXML2_SRC_SHA" "$XML_TB"
homescoop_fetch "$SQLITE_SRC_URL" "$SQLITE_SRC_SHA" "$SQ_ZIP"
tar xzf "$SRCS/wasix-zlib.tgz" -C "$DEPS/wasix-zlib"
tar xzf "$SRCS/wasix-openssl.tgz" -C "$DEPS/wasix-openssl"
test -f "$ZLIB_PREFIX/lib/libz.a" && test -f "$ZLIB_PREFIX/include/zlib.h"
test -f "$OPENSSL_PREFIX/lib/libssl.a" && test -f "$OPENSSL_PREFIX/include/openssl/ssl.h"
ZLIB_PKG="$(node -p "require('$ZLIB_PREFIX/package.json').version")"
OPENSSL_PKG="$(node -p "require('$OPENSSL_PREFIX/package.json').version")"
OPENSSL_UPSTREAM="$(sed -n 's/^# *define OPENSSL_VERSION_STR "\([0-9.]*\)"$/\1/p' "$OPENSSL_PREFIX/include/openssl/opensslv.h")"
ZLIB_UPSTREAM="$(sed -n 's/^#define ZLIB_VERSION "\([0-9.]*\)"$/\1/p' "$ZLIB_PREFIX/include/zlib.h")"
[[ -n "$OPENSSL_UPSTREAM" && -n "$ZLIB_UPSTREAM" ]] || { echo "homescoop wasix-php: no zlib/OpenSSL version in the dev packages" >&2; exit 1; }
export PKG_CONFIG_PATH="$DEPS/lib/pkgconfig:$OPENSSL_PREFIX/lib/pkgconfig:$ZLIB_PREFIX/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$PKG_CONFIG_PATH"

# --- libxml2 (static; PHP's dom, xml, simplexml, xmlreader, xmlwriter) -------
XML_SRC="$BUILD/libxml2-$LIBXML2_VERSION"
if [[ -z "$REUSE" || ! -f "$DEPS/lib/libxml2.a" ]]; then
  echo "== wasix-php: libxml2 $LIBXML2_VERSION"
  rm -rf "$XML_SRC"
  tar xJf "$XML_TB" -C "$BUILD"
  (
    cd "$XML_SRC"
    ./configure --host="$HOST_TRIPLE" --build="$BUILD_TRIPLE" --prefix="$DEPS" \
      --sysconfdir=/etc --disable-shared --enable-static --without-python --without-threads \
      --without-modules --without-http --without-debug --without-readline \
      --without-history --without-zlib --without-icu --with-iconv \
      CC=wasixcc AR=llvm-ar RANLIB=llvm-ranlib CFLAGS="$DEP_CFLAGS" >"$BUILD/libxml2-configure.log" 2>&1
    make -j"$JOBS" libxml2.la >"$BUILD/libxml2-make.log" 2>&1
    make install-libLTLIBRARIES install-pkgconfigDATA >>"$BUILD/libxml2-make.log" 2>&1
    make -C include install >>"$BUILD/libxml2-make.log" 2>&1
  ) || { tail -40 "$BUILD"/libxml2-*.log >&2; exit 1; }
  rm -f "$DEPS"/lib/libxml2.la
fi
test -f "$DEPS/lib/libxml2.a" && test -f "$DEPS/lib/pkgconfig/libxml-2.0.pc"

# --- SQLite amalgamation (static; sqlite3 and pdo_sqlite) --------------------
# wasix-python's options, single-threaded (PHP is NTS). No WAL: it needs
# shared-memory mmap, which WASIX doesn't have.
SQ_DIR="$BUILD/sqlite"
if [[ -z "$REUSE" || ! -f "$DEPS/lib/libsqlite3.a" ]]; then
  echo "== wasix-php: sqlite"
  rm -rf "$SQ_DIR" && mkdir -p "$SQ_DIR"
  unzip -q -o "$SQ_ZIP" -d "$SQ_DIR"
  SQ="$(echo "$SQ_DIR"/sqlite-amalgamation-*)"
  # shellcheck disable=SC2086
  wasixcc $DEP_CFLAGS -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_OMIT_WAL \
    -DSQLITE_ENABLE_COLUMN_METADATA -DSQLITE_ENABLE_DBSTAT_VTAB -DSQLITE_ENABLE_FTS5 \
    -DSQLITE_ENABLE_MATH_FUNCTIONS -DSQLITE_ENABLE_RTREE -DSQLITE_DEFAULT_AUTOVACUUM=0 \
    -DSQLITE_DEFAULT_RECURSIVE_TRIGGERS=0 -DSQLITE_DISABLE_LFS -DSQLITE_DEFAULT_UNIX_VFS='"unix"' \
    -c "$SQ/sqlite3.c" -o "$SQ_DIR/sqlite3.o"
  rm -f "$DEPS/lib/libsqlite3.a"
  llvm-ar rcs "$DEPS/lib/libsqlite3.a" "$SQ_DIR/sqlite3.o"
  cp "$SQ/sqlite3.h" "$SQ/sqlite3ext.h" "$DEPS/include/"
  SQV="$(sed -n 's/^#define SQLITE_VERSION *"\(.*\)"/\1/p' "$SQ/sqlite3.h")"
  cat >"$DEPS/lib/pkgconfig/sqlite3.pc" <<EOF
prefix=$DEPS
libdir=\${prefix}/lib
includedir=\${prefix}/include

Name: sqlite3
Description: SQLite (homescoop wasix-php build, static)
Version: $SQV
Libs: -L\${libdir} -lsqlite3
Cflags: -I\${includedir}
EOF
fi
SQLITE_UPSTREAM="$(pkg-config --modversion sqlite3)"
LIBXML2_UPSTREAM="$(pkg-config --modversion libxml-2.0)"
[[ "$LIBXML2_UPSTREAM" == "$LIBXML2_VERSION" ]] || { echo "homescoop wasix-php: libxml2 is $LIBXML2_UPSTREAM, not $LIBXML2_VERSION" >&2; exit 1; }

# --- PHP --------------------------------------------------------------------
if [[ -z "$REUSE" ]]; then
  echo "== wasix-php: extract php $VER and apply patches/"
  rm -rf "$SRC"
  tar xJf "$PHP_TB" -C "$BUILD"
  # The release date, from the tarball's own mtimes (php -v's "built:" and
  # every other __DATE__/__TIME__), before a patch touches anything.
  if stat -c %Y "$SRC/main/php_version.h" >/dev/null 2>&1; then
    SOURCE_DATE_EPOCH="$(stat -c %Y "$SRC/main/php_version.h")"
  else
    SOURCE_DATE_EPOCH="$(stat -f %m "$SRC/main/php_version.h")"
  fi
  echo "$SOURCE_DATE_EPOCH" >"$BUILD/source-date-epoch"
  for p in "$PKG"/patches/*.patch; do
    echo "== patch $(basename "$p")"
    patch -d "$SRC" -p1 --no-backup-if-mismatch <"$p" || {
      echo "homescoop wasix-php: $(basename "$p") does not apply to php $VER (a patch failure, not a checksum error)" >&2
      exit 1
    }
  done
  # Each patch, by a line only it adds.
  grep -q 'ZEND_FIBER_UNAVAILABLE' "$SRC/configure"
  grep -q 'PHP_OS=WASI' "$SRC/configure"
  grep -q 'Fibers are not available on this platform' "$SRC/Zend/zend_fibers.c"
  grep -q '!defined(ZEND_WIN32) && !defined(__wasi__)' "$SRC/Zend/zend_portability.h"
  grep -q 'zend_mm_wasi_take' "$SRC/Zend/zend_alloc.c"
  grep -q 'define P_tmpdir "/tmp"' "$SRC/main/php_open_temporary_file.c"
  grep -q 'defined(HAVE_UNISTD_H) && !defined(__wasi__)' "$SRC/ext/standard/php_fopen_wrapper.c"
  grep -q 'php_wasix_env_proxy' "$SRC/ext/standard/http_fopen_wrapper.c"
  grep -q '(defined(__aarch64__) && defined(__APPLE__)) || defined(__wasi__)' "$SRC/Zend/zend_execute_API.c"
  grep -q 'zend_call_stack_get_wasi' "$SRC/Zend/zend_call_stack.c"
  grep -q 'ZEND_WASI_CALL_STACK_FRAME' "$SRC/Zend/zend_call_stack.h"
fi
SOURCE_DATE_EPOCH="$(cat "$BUILD/source-date-epoch")"
export SOURCE_DATE_EPOCH

# Cross answers for configure's run tests (each defaults to "no" when cross
# compiling), from wasix-libc and slicc-kernel's behaviour.
cat >"$BUILD/config.site" <<'SITE'
# write(2) to stdout works (PHP_WRITE_STDOUT: the CLI writes with write()).
php_cv_have_write_stdout=yes
# wasix-libc has getaddrinfo (the kernel's resolver); pread/pwrite work.
php_cv_func_getaddrinfo=yes
php_cv_func_pread=yes
php_cv_func_pwrite=yes
# wasix-libc is musl.
php_cv_c_standard_library=musl
php_cv_have_stack_limit=yes
SITE

if [[ -z "$REUSE" ]]; then
  echo "== wasix-php: configure"
  (
    cd "$SRC"
    # PHP_UNAME and PHP_BUILD_SYSTEM default to the build machine's uname -a.
    CONFIG_SITE="$BUILD/config.site" \
    PHP_UNAME="WASI slicc wasm32" \
    PHP_BUILD_SYSTEM="wasm32-wasix (homescoop wasix-php, wasixcc on wasix-sysroot $SYSROOT_VER)" \
    PHP_BUILD_PROVIDER="homescoop (https://github.com/ai-ecoverse/homescoop)" \
    ./configure --host="$HOST_TRIPLE" --build="$BUILD_TRIPLE" --prefix=/usr \
      --with-config-file-path=/etc/php --with-config-file-scan-dir=/etc/php/conf.d \
      --disable-all --enable-cli --disable-cgi --disable-phpdbg --without-pear \
      --without-valgrind --disable-fiber-asm --disable-zend-max-execution-timers \
      --disable-opcache-jit --without-pcre-jit \
      --enable-bcmath --enable-calendar --enable-ctype --enable-dom --enable-exif \
      --enable-fileinfo --enable-filter --with-iconv --with-libxml --enable-mbstring \
      --disable-mbregex --with-openssl --enable-pcntl --enable-pdo --with-pdo-sqlite \
      --enable-phar --enable-posix --enable-session --enable-simplexml --with-sqlite3 \
      --enable-tokenizer --enable-xml --enable-xmlreader --enable-xmlwriter --with-zlib \
      CC=wasixcc AR=llvm-ar RANLIB=llvm-ranlib \
      CFLAGS="-O2 -ffile-prefix-map=$WORK=. $EMU_CPPFLAGS" CPPFLAGS="$EMU_CPPFLAGS" \
      LIBS="$EMU_LIBS" \
      >"$BUILD/php-configure.log" 2>&1
  ) || { tail -60 "$BUILD/php-configure.log" >&2; exit 1; }

  python3 - "$SRC" "$WORK" "$HOMESCOOP_ROOT" "$BUILD_TRIPLE" <<'PY'
import re, sys
from pathlib import Path
src, work, root, build = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
cfg = (src / "main/php_config.h").read_text()
want = {
    "ZEND_FIBER_UNAVAILABLE": "1", "PHP_OS": '"WASI"', "HAVE_GETADDRINFO": "1",
    "PHP_WRITE_STDOUT": "1", "HAVE_FORK": "1", "HAVE_LIBXML": "1",
    "ZEND_CHECK_STACK_LIMIT": "1",
}
for k, v in want.items():
    if not re.search(rf"^#define {k} {re.escape(v)}$", cfg, re.M):
        raise SystemExit(f"homescoop wasix-php: configure left {k} != {v} in main/php_config.h")
if re.search(r"^#define ZEND_FIBER_UCONTEXT", cfg, re.M):
    raise SystemExit("homescoop wasix-php: configure found a ucontext.h")
# phpinfo()'s "Configure Command": drop the build machine's triple and the
# dev packages' pkg-config paths (both depend on where the build runs).
bd = src / "main/build-defs.h"
t = bd.read_text()
n0 = len(t)
t = re.sub(r" '(--build|build_alias)=[^']*'", "", t)
t = re.sub(r" 'PKG_CONFIG_(PATH|LIBDIR)=[^']*'", "", t)
bd.write_text(t)
for f in ("main/build-defs.h", "main/php_config.h"):
    s = (src / f).read_text()
    for needle in (work, root, build, "/home/runner", "/Users/"):
        if needle in s:
            raise SystemExit(f"homescoop wasix-php: {f} names {needle}")
print(f"configure: fibers unavailable, PHP_OS WASI; build-defs.h scrubbed ({n0 - len(t)} bytes of build paths)")
PY

  echo "== wasix-php: make (initial memory ${WASM_INITIAL_MEMORY:?} bytes, WASIXCC_LINKER_FLAGS=${WASIXCC_LINKER_FLAGS:-})"
  # Targets after the link (phar.phar, the man pages) run the target php
  # and fail on the build machine; make ignores those (-@ in the Makefile).
  make -C "$SRC" -j"$JOBS" >"$BUILD/php-make.log" 2>&1 || { grep -E "error:|Error " "$BUILD/php-make.log" | head -40 >&2; tail -30 "$BUILD/php-make.log" >&2; exit 1; }
fi
test -f "$SRC/sapi/cli/php"
[[ "$(head -c 4 "$SRC/sapi/cli/php" | od -An -tx1 | tr -d ' \n')" == 0061736d ]] || { echo "homescoop wasix-php: sapi/cli/php is not a wasm module" >&2; exit 1; }

echo "== wasix-php: wasm-opt --asyncify (fork, setjmp)"
# Asyncify with the imports that unwind: proc_fork (pcntl_fork) and the
# setjmp snapshot pair. Not asyncify-ignore-indirect: the executor calls
# opcode handlers and internal functions indirectly, and a bailout (setjmp)
# or fork can be below any of them. --strip-dwarf keeps the name section,
# so a trap's backtrace names its functions.
rm -rf "$DEST/bin" "$DEST/etc" "$DEST/licenses" "$DEST/patches"
mkdir -p "$DEST/bin" "$DEST/etc" "$DEST/licenses" "$DEST/patches"
"$WASM_OPT" --asyncify -O1 -g --strip-dwarf \
  --pass-arg=asyncify-imports@wasix_32v1.proc_fork,wasix_32v1.stack_checkpoint,wasix_32v1.stack_restore \
  "$SRC/sapi/cli/php" -o "$DEST/bin/php.wasm" 2>&1 | tee "$BUILD/asyncify.log" | tail -20
chmod 0755 "$DEST/bin/php.wasm"
echo "asyncify: $(wc -c <"$SRC/sapi/cli/php") -> $(wc -c <"$DEST/bin/php.wasm") bytes"

python3 - "$DEST/bin/php.wasm" "$WORK" "$HOMESCOOP_ROOT" "$SYSROOT_VER" "${WASM_INITIAL_MEMORY:?}" <<'PY'
import sys
from pathlib import Path
wasm, work, root, sysroot, initial = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
d = wasm.read_bytes()
for needle in (work.encode(), root.encode(), b"/opt/homebrew/", b"/home/runner/", b"/Users/", b"homescoop-rebuild"):
    if needle in d:
        raise SystemExit(f"homescoop wasix-php: php.wasm names a build path: {needle!r}")
if f"wasix-sysroot {sysroot}".encode() not in d:
    raise SystemExit(f"homescoop wasix-php: php.wasm lacks the slicc.libc marker for wasix-sysroot {sysroot}")
for s in (b"asyncify_start_unwind", b"Fibers are not available on this platform", b"zend.max_allowed_stack_size"):
    if s not in d:
        raise SystemExit(f"homescoop wasix-php: php.wasm lacks {s!r}")
# The imported memory's initial page count is the recipe's.
p = 8
def leb():
    global p
    r = s = 0
    while True:
        b = d[p]; p += 1; r |= (b & 0x7F) << s; s += 7
        if b < 0x80:
            return r
pages = None
while p < len(d):
    sid = d[p]; p += 1
    n = leb(); end = p + n
    if sid == 2:
        for _ in range(leb()):
            mod = d[p + 1:p + 1 + d[p]]; p += 1 + d[p]
            ln = leb(); p += ln
            kind = d[p]; p += 1
            if kind == 2:
                flags = d[p]; p += 1
                pages = leb()
                if flags & 1:
                    leb()
                break
            elif kind == 0:
                leb()
            elif kind == 1:
                p += 1; flags = d[p]; p += 1; leb()
                if flags & 1: leb()
            elif kind == 3:
                p += 2
        p = end
        break
    p = end
if pages is None or pages * 65536 != initial:
    raise SystemExit(f"homescoop wasix-php: php.wasm's initial memory is {pages} pages, not {initial // 65536} (recipe.yaml wasm.initial-memory)")
print(f"php.wasm: no build paths, slicc.libc wasix-sysroot {sysroot}, asyncify, {pages} initial pages")
PY

# --- licences, notices, sources ----------------------------------------------
homescoop_stage_licenses "$SRC/LICENSE" "$SRC/Zend/LICENSE"
cp "$SRC/LICENSE" "$DEST/licenses/php-LICENSE"
cp "$SRC/Zend/LICENSE" "$DEST/licenses/zend-LICENSE"
cp "$SRC/TSRM/LICENSE" "$DEST/licenses/tsrm-LICENSE"
cp "$SRC/README.REDIST.BINS" "$DEST/licenses/php-README.REDIST.BINS"
cp "$SRC/ext/mbstring/libmbfl/LICENSE" "$DEST/licenses/libmbfl-LICENSE"
cp "$SRC/ext/bcmath/libbcmath/LICENSE" "$DEST/licenses/libbcmath-LICENSE"
cp "$SRC/ext/date/lib/LICENSE.rst" "$DEST/licenses/timelib-LICENSE.rst"
cp "$SRC/ext/fileinfo/libmagic/LICENSE" "$DEST/licenses/libmagic-LICENSE"
cp "$SRC/ext/lexbor/LICENSE" "$DEST/licenses/lexbor-LICENSE"
cp "$SRC/ext/uri/uriparser/COPYING.BSD-3-Clause" "$DEST/licenses/uriparser-COPYING"
cp "$SRC/ext/standard/libavifinfo/LICENSE" "$DEST/licenses/libavifinfo-LICENSE"
cp "$XML_SRC/Copyright" "$DEST/licenses/libxml2-Copyright"
cp "$PKG"/patches/*.patch "$DEST/patches/"
cp "$PKG/openssl.cnf" "$DEST/etc/openssl.cnf"
SQ_BLESSING="$BUILD/sqlite-blessing.txt"
sed -n '1,/May you share freely/p' "$DEPS/include/sqlite3.h" >"$SQ_BLESSING"
grep -q 'May you share freely' "$SQ_BLESSING"

homescoop_notices_begin "bin/php.wasm is PHP $VER (PHP-3.01, with the Zend Engine under Zend-2.0; package/LICENSE). It statically links the libraries PHP bundles, zlib, OpenSSL, libxml2, SQLite and the wasix libc. Each section has the component's licence text."
homescoop_notice "Code bundled in PHP's source: PCRE2 (BSD-3-Clause), crypt, rand, scanf, strnatcmp, snprintf, xxHash and the rest (PHP's README.REDIST.BINS)" \
  "$SRC/README.REDIST.BINS" -
homescoop_notice "libmbfl (ext/mbstring), LGPL-2.1-or-later" "$SRC/ext/mbstring/libmbfl/LICENSE" -
homescoop_notice "libbcmath (ext/bcmath), LGPL-2.1-or-later" "$SRC/ext/bcmath/libbcmath/LICENSE" -
homescoop_notice "timelib (ext/date), MIT" "$SRC/ext/date/lib/LICENSE.rst" -
homescoop_notice "libmagic (ext/fileinfo), BSD-2-Clause" "$SRC/ext/fileinfo/libmagic/LICENSE" -
homescoop_notice "Lexbor (ext/lexbor), Apache-2.0" "$SRC/ext/lexbor/LICENSE" -
homescoop_notice "uriparser (ext/uri), BSD-3-Clause" "$SRC/ext/uri/uriparser/COPYING.BSD-3-Clause" -
homescoop_notice "libavifinfo (ext/standard), BSD-2-Clause" "$SRC/ext/standard/libavifinfo/LICENSE" -
homescoop_notice "TSRM (part of PHP), a BSD licence" "$SRC/TSRM/LICENSE" -
homescoop_notice "zlib $ZLIB_UPSTREAM (@ai-ecoverse/wasix-zlib $ZLIB_PKG), Zlib" "$ZLIB_PREFIX/LICENSE" -
homescoop_notice "OpenSSL $OPENSSL_UPSTREAM (@ai-ecoverse/wasix-openssl $OPENSSL_PKG), Apache-2.0" "$OPENSSL_PREFIX/LICENSE" -
homescoop_notice "libxml2 $LIBXML2_UPSTREAM, MIT" "$XML_SRC/Copyright" -
homescoop_notice "SQLite $SQLITE_UPSTREAM, public domain (SPDX blessing)" "$SQ_BLESSING" -
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2026-07-03.1
homescoop_notice "wasix-libc (@ai-ecoverse/wasix-sysroot $SYSROOT_VER; files from tag v2026-07-03.1), Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af \
  "$WLIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0

{
  echo "# Sources"
  echo
  echo "bin/php.wasm is built from these sources, with \`patches/\` applied to PHP:"
  echo
  echo "| source | sha256 |"
  echo "| --- | --- |"
  echo "| [php-$VER.tar.xz]($SRC_URL) | \`$SRC_SHA\` |"
  echo "| [libxml2-$LIBXML2_VERSION.tar.xz]($LIBXML2_SRC_URL) | \`$LIBXML2_SRC_SHA\` |"
  echo "| [$(basename "$SQLITE_SRC_URL")]($SQLITE_SRC_URL) | \`$SQLITE_SRC_SHA\` |"
  echo "| [@ai-ecoverse/wasix-zlib $ZLIB_PKG]($WASIX_ZLIB_SRC_URL) | \`$WASIX_ZLIB_SRC_SHA\` |"
  echo "| [@ai-ecoverse/wasix-openssl $OPENSSL_PKG]($WASIX_OPENSSL_SRC_URL) | \`$WASIX_OPENSSL_SRC_SHA\` |"
  echo
  echo "Build recipe: https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-php"
} >"$DEST/SOURCES.md"

if ! grep -qxF -- "- Built on wasix-sysroot $SYSROOT_VER (the asyncify tree, for real fork)" "$DEST/README.md"; then
  echo "homescoop wasix-php: package/README.md doesn't name the wasix-sysroot it was built on ($SYSROOT_VER) (homescoop#752)" >&2
  exit 1
fi

python3 - "$DEST" "$VER" "$PKG_VER" "$SYSROOT_VER" "$ZLIB_PKG" "$OPENSSL_PKG" "$LIBXML2_UPSTREAM" "$SQLITE_UPSTREAM" <<'PY'
import json, sys
from pathlib import Path
dest, ver, pkg_ver, sysroot, zlib, openssl, libxml2, sqlite = Path(sys.argv[1]), *sys.argv[2:]
old = json.loads((dest / "package.json").read_text())
pkg = {
    "name": "@ai-ecoverse/wasix-php",
    "version": pkg_ver,
    "description": old["description"],
    "engines": old["engines"],
    "license": "PHP-3.01 AND Zend-2.0",
    "repository": {"type": "git", "url": "git+https://github.com/ai-ecoverse/homescoop.git", "directory": "packages/wasix-php/package"},
    "homepage": "https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-php",
    "keywords": ["wasm", "wasi", "wasix", "slicc", "homescoop", "php"],
    "files": ["README.md", "LICENSE", "THIRD-PARTY-NOTICES.md", "SOURCES.md", "bin", "etc", "licenses", "patches"],
    "publishConfig": {"access": "public"},
    "homescoop": {
        "recipe": "wasix-php",
        "upstream": ver,
        "sysroot": f"@ai-ecoverse/wasix-sysroot@{sysroot}",
        "zlib": f"@ai-ecoverse/wasix-zlib@{zlib}",
        "openssl": f"@ai-ecoverse/wasix-openssl@{openssl}",
        "libxml2": libxml2,
        "sqlite": sqlite,
    },
    "slicc": {"abi": "wasi", "commands": {"php": {"wasm": "bin/php.wasm", "env": {"OPENSSL_CONF": "${package}/etc/openssl.cnf"}}}},
}
if old.get("slicc") != pkg["slicc"]:
    raise SystemExit(f"homescoop wasix-php: the committed package.json's slicc block {old.get('slicc')} isn't the build's {pkg['slicc']}")
(dest / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")
print("package.json", pkg_ver, sorted(pkg["slicc"]["commands"]))
PY

test -s "$DEST/etc/openssl.cnf"
echo "== wasix-php staged $PKG_VER"
ls -la "$DEST/bin"
du -sh "$DEST/bin/php.wasm"
