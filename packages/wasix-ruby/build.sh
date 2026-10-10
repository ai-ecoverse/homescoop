#!/usr/bin/env bash
# Cross-build MRI Ruby for slicc WASIX via wasixcc + asyncify sysroot.
# SLICC has no epoll (ENOSYS 52); MRI must use poll()/timer-thread, not MN+epoll.
set -euo pipefail

HOMESCOOP_ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=/dev/null
source "$HOMESCOOP_ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-ruby

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
VER="$VERSION"
PKG_VER="${VER}-7"
# Baked-in load paths must not match any real VFS path (ipk install, /ruby, /usr).
# Manifest RUBYLIB is authoritative; see relocatable acceptance note in PRESTAGE.md.
RUBY_PREFIX="${RUBY_PREFIX:-/nonexistent-ruby-prefix}"
# MRI wasm asyncify spill buffers (setjmp / fiber / GC scan). Upstream default
# is 6144. There is no RB_WASM_ASYNCIFY symbol — these three macros size the
# buffers embedded in rb_wasm_jmp_buf (often stack-allocated). Changing them
# requires a FULL clean rebuild of every TU (core + ext archives); partial
# relink of wasm/{setjmp,fiber,machine}.o alone leaves inverted ABI skew and
# _rb_wasm_setjmp_internal "unexpected state". Prefer 65536 for -3 only after
# wiping work/build; never mix with a tree configured for another size.
ASYNCIFY_BUF="${RUBY_ASYNCIFY_BUF:-65536}"
WORK="${WASIX_RUBY_WORK:-$PKG/work}"
SRC="$WORK/ruby-$VER"
STAGE="$WORK/stage"
# OpenSSL and zlib: the published wasix-openssl / wasix-zlib dev packages
# (static lib/ flavour), pinned by sha in recipe.yaml (sources). Override with
# WASIX_OPENSSL_PREFIX / WASIX_ZLIB_PREFIX for a local prefix.
DEPS="$WORK/deps"
OPENSSL_PREFIX="${WASIX_OPENSSL_PREFIX:-$DEPS/wasix-openssl/package}"
ZLIB_PREFIX="${WASIX_ZLIB_PREFIX:-$DEPS/wasix-zlib/package}"
YAML_VER="0.2.5"
YAML_SRC="$WORK/yaml-$YAML_VER"

# No wasixcc on PATH (CI runners): install the pinned toolchain
# (wasix-sysroot -17 since #180), as wasix-gnupg and wasix-perl do.
if ! command -v wasixcc >/dev/null && [[ ! -x "${WASIXCC_PREFIX:-$HOME/.wasixcc}/bin/wasixcc" ]]; then
  eval "$(bash "$HOMESCOOP_ROOT/scripts/install-wasixcc.sh")"
fi
WASM_OPT="${WASM_OPT:-${WASIXCC_BINARYEN_LOCATION:-$HOME/.wasixcc/binaryen}/bin/wasm-opt}"
export PATH="${WASIXCC_PREFIX:-$HOME/.wasixcc}/bin:${WASIXCC_LLVM_LOCATION:-$HOME/.wasixcc/llvm}/bin:/opt/homebrew/bin:$PATH"
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS="${WASIXCC_WASM_EXCEPTIONS:-no}"
export WASIXCC_PIC=no
export WASIXCC_MODULE_KIND="${WASIXCC_MODULE_KIND:-static-main}"
unset FREETYPE FREETYPE_ROOT JPEG JPEG_ROOT PNG_ROOT ZLIB_ROOT VIRTUAL_ENV
unset PKG_CONFIG_LIBDIR ZLIB CFLAGS CPPFLAGS LDFLAGS CXX
# Only the WASIX dev packages' pkg-config files, never the host's.
export PKG_CONFIG_PATH="${OPENSSL_PREFIX}/lib/pkgconfig:${ZLIB_PREFIX}/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$PKG_CONFIG_PATH"

command -v wasixcc >/dev/null || {
  echo "homescoop wasix-ruby: wasixcc not on PATH" >&2
  exit 1
}

mkdir -p "$WORK" "$DEST/bin" "$DEST/lib"
TARBALL="$WORK/ruby-${VER}.tar.gz"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$TARBALL"

# Dev packages and libyaml, sha-pinned (recipe.yaml sources).
for dep in wasix_zlib wasix_openssl; do
  homescoop_load_recipe wasix-ruby --source "$dep"
  url_var="${dep^^}_SRC_URL"; sha_var="${dep^^}_SRC_SHA"
  name="${dep//_/-}"
  if [[ ( "$name" == wasix-zlib && -z "${WASIX_ZLIB_PREFIX:-}" ) || ( "$name" == wasix-openssl && -z "${WASIX_OPENSSL_PREFIX:-}" ) ]]; then
    homescoop_fetch "${!url_var}" "${!sha_var}" "$WORK/$name.tgz"
    rm -rf "$DEPS/$name" && mkdir -p "$DEPS/$name"
    tar xzf "$WORK/$name.tgz" -C "$DEPS/$name"
  fi
done
test -f "$OPENSSL_PREFIX/lib/libssl.a" && test -f "$OPENSSL_PREFIX/include/openssl/ssl.h"
test -f "$ZLIB_PREFIX/lib/libz.a" && test -f "$ZLIB_PREFIX/include/zlib.h"
homescoop_load_recipe wasix-ruby --source libyaml
YAML_TB="$WORK/yaml-${YAML_VER}.tar.gz"
homescoop_fetch "$LIBYAML_SRC_URL" "$LIBYAML_SRC_SHA" "$YAML_TB"
if [[ ! -d "$YAML_SRC" ]]; then
  tar xzf "$YAML_TB" -C "$WORK"
fi
YAML_PREFIX="$WORK/yaml-prefix"
if [[ ! -f "$YAML_PREFIX/lib/libyaml.a" ]]; then
  echo "== wasix-ruby: hand-compile libyaml $YAML_VER (autoconf host=wasi is unrecognized)"
  mkdir -p "$YAML_PREFIX/include" "$YAML_PREFIX/lib" "$WORK/yaml-objs"
  cat > "$YAML_PREFIX/include/config.h" <<'EOF'
#define HAVE_DLFCN_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_MEMORY_H 1
#define HAVE_STDINT_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRINGS_H 1
#define HAVE_STRING_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_UNISTD_H 1
#define PACKAGE "yaml"
#define PACKAGE_NAME "yaml"
#define PACKAGE_STRING "yaml 0.2.5"
#define PACKAGE_TARNAME "yaml"
#define PACKAGE_VERSION "0.2.5"
#define VERSION "0.2.5"
#define YAML_VERSION_MAJOR 0
#define YAML_VERSION_MINOR 2
#define YAML_VERSION_PATCH 5
#define YAML_VERSION_STRING "0.2.5"
EOF
  cp "$YAML_SRC/include/yaml.h" "$YAML_PREFIX/include/yaml.h"
  cp "$YAML_PREFIX/include/config.h" "$YAML_SRC/include/config.h"
  for s in api reader scanner parser loader writer emitter dumper; do
    WASIXCC_WASM_EXCEPTIONS=no WASIXCC_PIC=no \
      wasixcc -c -O2 -DHAVE_CONFIG_H -DYAML_DECLARE_STATIC \
        -I"$YAML_PREFIX/include" -I"$YAML_SRC/include" \
        -o "$WORK/yaml-objs/${s}.o" "$YAML_SRC/src/${s}.c"
  done
  llvm-ar rcs "$YAML_PREFIX/lib/libyaml.a" "$WORK"/yaml-objs/*.o
  llvm-ranlib "$YAML_PREFIX/lib/libyaml.a"
fi
test -f "$YAML_PREFIX/lib/libyaml.a"

if [[ ! -d "$SRC" || -n "${FORCE:-}" ]]; then
  rm -rf "$SRC"
  tar xzf "$TARBALL" -C "$WORK"
fi

# Bundled gem *native* exts pull crt1.o / fail PIC; keep pure-Ruby gems.
# date/openssl/zlib/psych/json live under ext/, not here.
for gem_ext in \
  "$SRC/.bundle/gems/debug-"*/ext \
  "$SRC/.bundle/gems/nkf-"*/ext \
  "$SRC/.bundle/gems/racc-"*/ext \
  "$SRC/.bundle/gems/rbs-"*/ext \
  "$SRC/.bundle/gems/syslog-"*/ext \
  "$SRC/.bundle/gems/bigdecimal-"*/ext
do
  if [[ -d "$gem_ext" ]]; then
    rm -rf "$gem_ext"
    echo "== wasix-ruby: drop bundled native ext $gem_ext"
  fi
done

# rbinstall reads BIGDECIMAL_VERSION from bigdecimal.c; we dropped the ext.
for gs in "$SRC"/.bundle/gems/bigdecimal-*/bigdecimal.gemspec; do
  [[ -f "$gs" ]] || continue
  python3 - "$gs" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
t = p.read_text()
t2, n = re.subn(
    r"source_version = \[.*?\]\.find do \|dir\|.*?end or raise .*?\n",
    'source_version = "3.1.8"\n',
    t,
    count=1,
    flags=re.S,
)
if n:
    p.write_text(t2)
    print("hardcoded bigdecimal gemspec version", p)
PY
done

python3 - "$SRC/ext/psych/extconf.rb" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
t = p.read_text()
needle = 'yaml_source = with_config("libyaml-source-dir")\n'
if needle in t and "YAML_PREFIX" not in t:
    insert = needle + (
        '# WASIX: autoconf host=wasi is unrecognized; use a prebuilt static libyaml.\n'
        'prebuilt = with_config("libyaml-dir") || ENV["YAML_PREFIX"]\n'
        'if prebuilt\n'
        '  prebuilt = prebuilt.gsub(/\\$\\((\\w+)\\)|\\$\\{(\\w+)\\}/) { ENV[$1 || $2] }\n'
        '  if File.exist?(File.join(prebuilt, "lib", "libyaml.a"))\n'
        '    yaml_source = nil\n'
        '    dir_config("libyaml", File.join(prebuilt, "include"), File.join(prebuilt, "lib"))\n'
        '  end\n'
        'end\n'
    )
    p.write_text(t.replace(needle, insert, 1))
    print("patched psych/extconf.rb to prefer prebuilt libyaml")
PY

# POSIX fd_set is not rb_fdset_t-with-.fdset (linux.c); term is a no-op macro.
python3 - "$SRC/ext/socket/ipsocket.c" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
t = p.read_text()
old = "    if (arg->readfds.fdset) rb_fd_term(&arg->readfds);\n    if (arg->writefds.fdset) rb_fd_term(&arg->writefds);\n"
new = "    rb_fd_term(&arg->readfds);\n    rb_fd_term(&arg->writefds);\n"
if old in t:
    p.write_text(t.replace(old, new, 1))
    print("patched ipsocket.c rb_fd_term for posix fd_set")
PY

# WASIX: Process.spawn/system/backticks/popen via posix_spawn (never fork).
# Parent: keep full Asyncify; do not compose proc_fork unwind with MRI rb_wasm_rt_start.
apply_wasix_patch() {
  local patch="$1" marker_file="$2" marker="${3:-WASIX_POSIX_SPAWN}"
  if [[ ! -f "$PKG/patches/$patch" ]]; then
    return 0
  fi
  if grep -q "$marker" "$marker_file" 2>/dev/null; then
    echo "== wasix-ruby: $patch already applied"
    return 0
  fi
  patch -p0 -d "$SRC" < "$PKG/patches/$patch"
  echo "== wasix-ruby: applied $patch"
}
apply_wasix_patch process-posix-spawn-wasi.patch "$SRC/process.c"
apply_wasix_patch io-posix-spawn-wasi.patch "$SRC/io.c"
apply_wasix_patch internal-process-posix-spawn-wasi.patch "$SRC/internal/process.h"
# Asyncify setjmp only rewinds inside rb_wasm_rt_start; wrap pthread start + TLS state.
apply_wasix_patch wasm-thread-asyncify-tls.patch "$SRC/thread_pthread.c" WASIX_WASM_THREAD_RT
# Advisory flock is ENOTSUP on WASIX; return success so File#flock / bundler.lock work.
apply_wasix_patch flock-wasi-noop.patch "$SRC/missing/flock.c" WASIX_FLOCK_NOOP

# OpenSSL 3 opaque structs: never compile the 1.0-era field-access fallbacks.
python3 - "$SRC/ext/openssl/openssl_missing.c" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
t = p.read_text()
needle = "#include \"openssl_missing.h\"\n"
inject = needle + """
#if defined(OPENSSL_VERSION_NUMBER) && OPENSSL_VERSION_NUMBER >= 0x10100000L
# ifndef HAVE_X509_CRL_GET0_SIGNATURE
#  define HAVE_X509_CRL_GET0_SIGNATURE 1
# endif
# ifndef HAVE_X509_REQ_GET0_SIGNATURE
#  define HAVE_X509_REQ_GET0_SIGNATURE 1
# endif
#endif
"""
if "HAVE_X509_CRL_GET0_SIGNATURE 1" not in t:
    if needle not in t:
        raise SystemExit("openssl_missing.c: inject point missing")
    p.write_text(t.replace(needle, inject, 1))
    print("patched openssl_missing.c for OpenSSL 1.1+/3 opaque structs")
PY

BUILD_CC="${BUILD_CC:-clang}"
TARGET_CC="wasixcc"

# Satisfy -lwasi-emulated-signal (asyncify sysroot ships getpid/mman/clocks only).
SYS_LIB="${WASIXCC_SYSROOT_PREFIX:-$HOME/.wasixcc/sysroot}/sysroot/lib/wasm32-wasi"
if [[ -d "$SYS_LIB" && ! -f "$SYS_LIB/libwasi-emulated-signal.a" ]]; then
  echo "void __wasix_emulated_signal_stub(void) {}" > "$WORK/signal_stub.c"
  WASIXCC_WASM_EXCEPTIONS=no WASIXCC_PIC=no wasixcc -c -O2 "$WORK/signal_stub.c" -o "$WORK/signal_stub.o"
  llvm-ar rcs "$SYS_LIB/libwasi-emulated-signal.a" "$WORK/signal_stub.o"
  echo "== wasix-ruby: stub $SYS_LIB/libwasi-emulated-signal.a"
fi

WASIXCC_WASM_EXCEPTIONS=no WASIXCC_PIC=no \
  wasixcc -c -O2 "$PKG/stubs/posix.c" -o "$WORK/ruby-wasix-stubs.o"
# An archive: ruby's link lists LIBS twice (configure's MAINLIBS and LIBS),
# and a plain .o given twice is a duplicate definition; archive members are
# pulled once. (madvise and dladdr: neither is in wasix-libc.)
rm -f "$WORK/libruby-wasix-stubs.a"
wasixar rcs "$WORK/libruby-wasix-stubs.a" "$WORK/ruby-wasix-stubs.o"

OPENSSL_FLAGS=()
OPENSSL_NOTE="skipped (no $OPENSSL_PREFIX/lib/libssl.a)"
if [[ -f "$OPENSSL_PREFIX/lib/libssl.a" && -f "$OPENSSL_PREFIX/include/openssl/ssl.h" ]]; then
  OPENSSL_FLAGS+=(
    "--with-openssl-dir=${OPENSSL_PREFIX}"
    "--with-openssl-include=${OPENSSL_PREFIX}/include"
    "--with-openssl-lib=${OPENSSL_PREFIX}/lib"
  )
  OPENSSL_NOTE="linked against ${OPENSSL_PREFIX} (OpenSSL 3.x; honours SSL_CERT_FILE). Socket C ext built with HAVE_STRUCT_MSGHDR_MSG_CONTROL / CMSG_* forced off (WASIX ancillary data incomplete)."
else
  echo "== wasix-ruby: openssl $OPENSSL_NOTE"
fi

ZLIB_FLAGS=()
if [[ -f "$ZLIB_PREFIX/lib/libz.a" ]]; then
  ZLIB_FLAGS+=(
    "--with-zlib-dir=${ZLIB_PREFIX}"
    "--with-zlib-include=${ZLIB_PREFIX}/include"
    "--with-zlib-lib=${ZLIB_PREFIX}/lib"
  )
fi

RUBY_CPPFLAGS="-I${ZLIB_PREFIX}/include -I${YAML_PREFIX}/include"
RUBY_LDFLAGS="-L${ZLIB_PREFIX}/lib -L${YAML_PREFIX}/lib"
if [[ -f "$OPENSSL_PREFIX/lib/libssl.a" ]]; then
  RUBY_CPPFLAGS="-I${OPENSSL_PREFIX}/include -I${ZLIB_PREFIX}/include -I${YAML_PREFIX}/include"
  RUBY_LDFLAGS="-L${OPENSSL_PREFIX}/lib -L${ZLIB_PREFIX}/lib -L${YAML_PREFIX}/lib"
fi

STAGE_ROOT="$STAGE$RUBY_PREFIX"
if [[ ! -f "$STAGE_ROOT/bin/ruby" && ! -f "$STAGE_ROOT/bin/ruby.wasm" ]] || [[ -n "${FORCE:-}" ]]; then
  # ASYNCIFY_BUF is baked into jmp_buf layout — never reuse a build tree that
  # was configured with a different size (partial wasm/*.o relinks invert ABI).
  # Prefix change also requires a clean tree (load paths baked into ruby.wasm).
  rm -rf "$STAGE" "$WORK/build"
  mkdir -p "$WORK/build" "$STAGE"
  (
    cd "$WORK/build"
    cat > "$WORK/wasix-config.site" <<'SITE'
# wasix-ruby config.site — WASIX cross; SLICC has no epoll/kqueue/eventfd/timerfd
ac_cv_func_setjmp=yes
ac_cv_func_longjmp=yes
ac_cv_func_sigsetjmp=yes
# Never HAVE_WORKING_FORK: Kernel#fork / Process.fork -> NotImplementedError.
# Spawn path is posix_spawn (wasix-libc -> WASIX proc_spawn3).
ac_cv_func_fork=no
ac_cv_func_fork_works=no
ac_cv_func_vfork=no
ac_cv_func_pipe=yes
ac_cv_func_pipe2=yes
ac_cv_func_mmap=yes
ac_cv_func_mprotect=yes
ac_cv_func_getcwd=yes
ac_cv_func_realpath=yes
ac_cv_func_strerror=yes
ac_cv_func_clock_gettime=yes
rb_cv_member_struct_tm_tm_gmtoff=yes
rb_cv_gcc_atomic_builtins=yes
rb_cv_gcc_sync_builtins=yes
rb_cv_function_name_string=__func__
ac_cv_func_clock_getres=yes
ac_cv_func_gmtime_r=yes
ac_cv_func_localtime_r=yes
ac_cv_func_getgroups=no
ac_cv_func_setgroups=no
ac_cv_func_initgroups=no
ac_cv_func_poll=yes
ac_cv_header_poll_h=yes
# SLICC WASIX host: epoll_create → ENOSYS (52). Force poll()/timer-thread.
ac_cv_header_sys_epoll_h=no
ac_cv_func_epoll_create=no
ac_cv_func_epoll_create1=no
ac_cv_header_sys_event_h=no
ac_cv_func_kqueue=no
ac_cv_func_kevent=no
ac_cv_header_sys_eventfd_h=no
ac_cv_func_eventfd=no
ac_cv_header_sys_timerfd_h=no
ac_cv_func_timerfd_create=no
ac_cv_func_timerfd_gettime=no
ac_cv_func_timerfd_settime=no
SITE
    export CONFIG_SITE="$WORK/wasix-config.site"
    # ruby's wasm tool check (tool/m4/ruby_wasm_tools.m4) requires
    # WASI_SDK_PATH and takes defaults from it; CC/LD/AR/RANLIB are given
    # below, OBJCOPY is <it>/bin/llvm-objcopy: the pinned wasixcc LLVM.
    export WASI_SDK_PATH="${WASI_SDK_PATH:-${WASIXCC_LLVM_LOCATION:-$HOME/.wasixcc/llvm}}"
    # The build machine's triple (CI: x86_64-pc-linux-gnu; a Mac: aarch64-apple-darwin…).
    BUILD_TRIPLE="${RUBY_BUILD_TRIPLE:-$("$SRC/tool/config.guess")}"
    "$SRC/configure" \
      --prefix="$RUBY_PREFIX" \
      --host=wasm32-wasi \
      --build="$BUILD_TRIPLE" \
      --with-gcc="$TARGET_CC" \
      --with-baseruby="${BASERUBY:-$(
        if [[ -x /opt/homebrew/opt/ruby/bin/ruby ]]; then echo /opt/homebrew/opt/ruby/bin/ruby
        elif command -v ruby3.4 >/dev/null; then command -v ruby3.4
        elif command -v ruby3 >/dev/null; then command -v ruby3
        else command -v ruby
        fi
      )}" \
      --disable-install-doc \
      --disable-install-rdoc \
      --disable-jit-support \
      --disable-shared \
      --enable-static \
      --with-thread=pthread \
      --with-static-linked-ext \
      --without-gmp \
      --without-valgrind \
      --with-out-ext=+,dbm,gdbm,readline,curses,tk,win32ole,fiddle,pty \
      --with-libyaml-dir="$YAML_PREFIX" \
      "${OPENSSL_FLAGS[@]}" \
      "${ZLIB_FLAGS[@]}" \
      CC="$TARGET_CC" \
      LD="$TARGET_CC" \
      AR="${AR:-llvm-ar}" \
      RANLIB="${RANLIB:-llvm-ranlib}" \
      CFLAGS="${RUBY_CFLAGS:--O2} -DUSE_MN_THREADS=0 -DWASM_SETJMP_STACK_BUFFER_SIZE=${ASYNCIFY_BUF} -DWASM_FIBER_STACK_BUFFER_SIZE=${ASYNCIFY_BUF} -DWASM_SCAN_STACK_BUFFER_SIZE=${ASYNCIFY_BUF}" \
      CPPFLAGS="$RUBY_CPPFLAGS -DWASM_SETJMP_STACK_BUFFER_SIZE=${ASYNCIFY_BUF} -DWASM_FIBER_STACK_BUFFER_SIZE=${ASYNCIFY_BUF} -DWASM_SCAN_STACK_BUFFER_SIZE=${ASYNCIFY_BUF}" \
      LDFLAGS="$RUBY_LDFLAGS" \
      LIBS="$WORK/libruby-wasix-stubs.a" \
      2>&1 | tee "$WORK/configure.log"
    python3 - "$WORK/build" <<'PY'
from pathlib import Path
import sys
root = Path(sys.argv[1])
# Force poll path even if a header probe leaked epoll/kqueue/eventfd/timerfd.
undef0 = [
    "HAVE_SYS_EPOLL_H",
    "HAVE_EPOLL",
    "HAVE_EPOLL_CREATE",
    "HAVE_EPOLL_CREATE1",
    "HAVE_SYS_EVENT_H",
    "HAVE_KQUEUE",
    "HAVE_KEVENT",
    "HAVE_SYS_EVENTFD_H",
    "HAVE_EVENTFD",
    "HAVE_SYS_TIMERFD_H",
    "HAVE_TIMERFD_CREATE",
    "HAVE_TIMERFD_GETTIME",
    "HAVE_TIMERFD_SETTIME",
    # WASIX has no getgroups(2); SETGROUPS without GETGROUPS breaks process.c.
    "HAVE_SETGROUPS",
    "HAVE_INITGROUPS",
    "HAVE_GETGROUPS",
]
# Socket: compile ext/socket but strip ancillary-data / CMSG paths (WASIX incomplete).
cmsg_undef = [
    "HAVE_STRUCT_MSGHDR_MSG_CONTROL",
    "HAVE_ST_MSG_CONTROL",
    "HAVE_STRUCT_MSGHDR_MSG_CONTROLLEN",
    "HAVE_ST_MSG_CONTROLLEN",
    "HAVE_TYPEOF_MSGHDR_MSG_CONTROL",
    "HAVE_TYPEOF_MSGHDR_MSG_CONTROLLEN",
]
need = {
    "HAVE_GCC_ATOMIC_BUILTINS": "1",
    "HAVE_GCC_SYNC_BUILTINS": "1",
    "HAVE_CLOCK_GETRES": "1",
    "HAVE_LSTAT": "1",
    "HAVE_MEMRCHR": "1",
    "HAVE_POLL": "1",
    "HAVE_SIGACTION": "1",
    "POSIX_SIGNAL": "1",
    "HAVE_GMTIME_R": "1",
    "HAVE_LOCALTIME_R": "1",
    "USE_MN_THREADS": "0",
    "RUBY_FUNCTION_NAME_STRING": "__func__",
    # posix_spawn -> WASIX proc_spawn3 (Process.spawn / system / popen).
    "HAVE_POSIX_SPAWN": "1",
    "HAVE_SPAWN_H": "1",
}
for cfg in list(root.glob(".ext/include/*/ruby/config.h")) + list(root.glob("include/*/ruby/config.h")):
    t = cfg.read_text()
    for k in undef0:
        t = t.replace(f"#define {k} 1", f"/* {k} forced off for SLICC */\n#define {k} 0")
        if f"#define {k}" not in t:
            t += f"\n#define {k} 0\n"
    # file.c uses !defined(HAVE_GETGROUPS), so 0-valued define is not enough.
    # Fork is unsupported on WASIX+Asyncify — force undef so Kernel#fork is notimplement.
    # CMSG: ancdata.c is #if defined(HAVE_STRUCT_MSGHDR_MSG_CONTROL) — must undef, not 0.
    for k in (
        "HAVE_GETGROUPS", "HAVE_SETGROUPS", "HAVE_INITGROUPS",
        "HAVE_WORKING_FORK", "HAVE_FORK",
        *cmsg_undef,
    ):
        t = t.replace(f"#define {k} 0", f"#undef {k}")
        t = t.replace(f"#define {k} 1", f"#undef {k}")
        if f"#undef {k}" not in t:
            t += f"\n#undef {k}\n"
    added = []
    for k, v in need.items():
        if f"#define {k} " not in t and f"#define {k}\t" not in t:
            added.append(f"#define {k} {v}")
        elif k == "USE_MN_THREADS":
            t = t.replace("#define USE_MN_THREADS 1", "#define USE_MN_THREADS 0")
    if added:
        t = t.rstrip() + "\n" + "\n".join(added) + "\n"
    cfg.write_text(t)
    print(cfg, "epoll/kqueue/eventfd/timerfd off; USE_MN_THREADS=0")
for path in (root / "enc.mk", root / "rbconfig.rb"):
    if not path.is_file():
        continue
    t = path.read_text()
    t2 = t.replace("CCDLFLAGS = -fPIC", "CCDLFLAGS =").replace(
        'CONFIG["CCDLFLAGS"] = "-fPIC"', 'CONFIG["CCDLFLAGS"] = ""'
    )
    if t2 != t:
        path.write_text(t2)
        print("stripped -fPIC from", path.name)
PY
    # Disable configure's POSTLINK during make — apply Binaryen once after link.
    # Parent decision: keep FULL Asyncify base (narrow proc_fork import cut is out).
    # Spawn uses posix_spawn/proc_spawn3; do not compose proc_fork unwind with MRI.
    if grep -q '^POSTLINK' Makefile; then
      sed -i.bak 's|^POSTLINK = .*|POSTLINK = :|' Makefile && rm -f Makefile.bak
      echo "== wasix-ruby: POSTLINK disabled for make (explicit wasm-opt after link)"
    fi
    if ! grep -q '^wasmoptflags' Makefile 2>/dev/null; then
      echo 'wasmoptflags =' >> Makefile
    fi
    echo "== wasix-ruby: ASYNCIFY spill buffers = ${ASYNCIFY_BUF}"
    make -j"${HOMESCOOP_JOBS:-4}" CCDLFLAGS= \
      LIBS="$WORK/libruby-wasix-stubs.a" \
      WASMOPT="$WASM_OPT" \
      2>&1 | tee "$WORK/make.log"
    test -f ruby || test -f ruby.wasm
    RUBY_LINKED=ruby
    [[ -f ruby ]] || RUBY_LINKED=ruby.wasm
    echo "== wasix-ruby: wasm-opt --asyncify (full base, -O1)"
    test -x "$WASM_OPT" || { echo "wasm-opt required at $WASM_OPT" >&2; exit 1; }
    PRE=$(wc -c < "$RUBY_LINKED")
    "$WASM_OPT" --asyncify -O1 \
      "$RUBY_LINKED" -o "$RUBY_LINKED.async" \
      2>&1 | tee "$WORK/asyncify.log" | tail -40
    mv "$RUBY_LINKED.async" "$RUBY_LINKED"
    POST=$(wc -c < "$RUBY_LINKED")
    echo "== wasix-ruby: asyncify $PRE -> $POST bytes"
    # Keep a copy — `make install` may relink without asyncify.
    cp "$RUBY_LINKED" "$WORK/ruby.asyncified.wasm"
    make DESTDIR="$STAGE" install CCDLFLAGS= \
      LIBS="$WORK/libruby-wasix-stubs.a" \
      POSTLINK=: \
      2>&1 | tee "$WORK/install.log"
    # Restore asyncified binary into DESTDIR (install may have overwritten).
    if [[ -f "$STAGE_ROOT/bin/ruby" ]]; then
      cp "$WORK/ruby.asyncified.wasm" "$STAGE_ROOT/bin/ruby"
    elif [[ -f "$STAGE_ROOT/bin/ruby.wasm" ]]; then
      cp "$WORK/ruby.asyncified.wasm" "$STAGE_ROOT/bin/ruby.wasm"
    fi
  )
fi

STAGE_ROOT="$STAGE$RUBY_PREFIX"
rm -rf "$DEST/bin" "$DEST/lib" "$DEST/share"
mkdir -p "$DEST/bin" "$DEST/lib"
# Prefer the asyncified artifact kept before DESTDIR install.
if [[ -f "$WORK/ruby.asyncified.wasm" ]]; then
  cp "$WORK/ruby.asyncified.wasm" "$DEST/bin/ruby.wasm"
elif [[ -f "$STAGE_ROOT/bin/ruby" ]]; then
  cp "$STAGE_ROOT/bin/ruby" "$DEST/bin/ruby.wasm"
elif [[ -f "$STAGE_ROOT/bin/ruby.wasm" ]]; then
  cp "$STAGE_ROOT/bin/ruby.wasm" "$DEST/bin/ruby.wasm"
elif [[ -f "$WORK/build/ruby" ]]; then
  cp "$WORK/build/ruby" "$DEST/bin/ruby.wasm"
fi
test -f "$DEST/bin/ruby.wasm"
# SLICC launch.resolve / MRI posix_spawnp PATH preflight need bin/ruby present;
# host then loads adjacent ruby.wasm via modulePath. Tiny #!wasm stub only —
# never a second full wasm copy.
printf '%s\n' '#!wasm' > "$DEST/bin/ruby"
chmod +x "$DEST/bin/ruby"
# RubyGems wrappers (gem/bundle/rake) — absolute args need these files present
for s in gem bundle bundler rake irb erb; do
  if [[ -f "$STAGE_ROOT/bin/$s" ]]; then
    cp "$STAGE_ROOT/bin/$s" "$DEST/bin/$s"
  fi
done

# MRI coroutine POSTLINK runs wasm-opt --asyncify. Export names alone do NOT
# distinguish instrumented vs uninstrumented (MRI also exports asyncify_*).
# Never re-run wasm-opt if it already transformed (Fatal: export already exists).
# Never partial-relink only wasm/{setjmp,fiber,machine}.o with a new
# WASM_*_STACK_BUFFER_SIZE — jmp_buf layout must match every TU in libruby.
if [[ -f "$DEST/bin/ruby.wasm" ]]; then
  echo "== wasix-ruby: linked $(wc -c < "$DEST/bin/ruby.wasm") bytes (asyncify via POSTLINK; no second wasm-opt)"
fi

if [[ -d "$STAGE_ROOT/lib/ruby" ]]; then
  cp -a "$STAGE_ROOT/lib/ruby" "$DEST/lib/"
fi
# Stdlib lives under API version (e.g. 3.4.0), NOT RUBY_VERSION (3.4.11).
# Never rsync source into lib/ruby/$VER — that created a second tree and a
# false RUBYLIB that omitted wasm32-wasi/rbconfig.rb.
API_LIB=""
for d in "$DEST"/lib/ruby/[0-9]*; do
  [[ -f "$d/rubygems.rb" ]] || continue
  API_LIB="$d"
  break
done
if [[ -z "$API_LIB" ]]; then
  # Last resort: install source lib into the API-version dir from rbconfig if present,
  # else 3.4.0 (MRI 3.4.x API).
  api_ver="3.4.0"
  if [[ -f "$DEST/lib/ruby/"*/wasm32-wasi/rbconfig.rb ]]; then
    api_ver=$(basename "$(dirname "$(dirname "$(echo "$DEST"/lib/ruby/*/wasm32-wasi/rbconfig.rb | head -1)")")")
  fi
  mkdir -p "$DEST/lib/ruby/$api_ver"
  rsync -a "$SRC/lib/" "$DEST/lib/ruby/$api_ver/"
  API_LIB="$DEST/lib/ruby/$api_ver"
  echo "== wasix-ruby: fallback stdlib → lib/ruby/$api_ver"
fi
# Drop any second version tree (e.g. accidental lib/ruby/3.4.11 from old fallback).
for d in "$DEST"/lib/ruby/[0-9]*; do
  [[ -d "$d" ]] || continue
  [[ "$d" == "$API_LIB" ]] && continue
  echo "== wasix-ruby: remove non-API lib tree $(basename "$d") (keeping $(basename "$API_LIB"))"
  rm -rf "$d"
done
# Baseruby/Homebrew can leak default gems into DESTDIR/opt/homebrew/... —
# merge them so bundler/rake gemspecs are under GEM_HOME.
GEMS_DEST="$DEST/lib/ruby/gems"
for leak in "$STAGE"/opt/homebrew/lib/ruby/gems/* "$STAGE"/usr/local/lib/ruby/gems/*; do
  [[ -d "$leak" ]] || continue
  echo "== wasix-ruby: merge leaked gems from $leak"
  mkdir -p "$GEMS_DEST"
  rsync -a "$leak/" "$GEMS_DEST/$(basename "$leak")/"
done
# Ensure bundler + rake gemspecs exist (bin/bundle and bin/rake activate gems)
ensure_gemspec() {
  local name="$1" src_glob="$2"
  if find "$GEMS_DEST" -path "*/specifications/*${name}*.gemspec" 2>/dev/null | grep -q .; then
    return 0
  fi
  local ver_dir
  ver_dir=$(find "$GEMS_DEST" -maxdepth 1 -type d -name '*.*' -print -quit)
  [[ -n "$ver_dir" ]] || { mkdir -p "$GEMS_DEST/${VER%.*}.0"; ver_dir="$GEMS_DEST/${VER%.*}.0"; }
  mkdir -p "$ver_dir/specifications/default" "$ver_dir/gems"
  local src
  # Prefer a known-good clean snapshot if present (harness/repro cache).
  for src in $src_glob \
    /tmp/slicc-ruby-repro/package-3-clean/lib/ruby/gems/3.4.0/specifications/*${name}*.gemspec \
    /tmp/slicc-ruby-repro/package-3-clean/lib/ruby/gems/3.4.0/specifications/default/*${name}*.gemspec
  do
    [[ -f "$src" ]] || continue
    if [[ "$src" == */default/* ]]; then
      cp "$src" "$ver_dir/specifications/default/"
    else
      cp "$src" "$ver_dir/specifications/"
    fi
    echo "== wasix-ruby: planted $(basename "$src") under $ver_dir/specifications"
    return 0
  done
  return 1
}
ensure_gemspec bundler "$SRC/lib/bundler/bundler.gemspec" || true
# rake lives as a bundled gem under gems/; copy gemspec+gem tree from clean snapshot if missing
if ! find "$GEMS_DEST" -path '*/specifications/rake-*.gemspec' 2>/dev/null | grep -q .; then
  CLEAN_GEMS=/tmp/slicc-ruby-repro/package-3-clean/lib/ruby/gems/3.4.0
  if [[ -d "$CLEAN_GEMS" ]]; then
    ver_dir=$(find "$GEMS_DEST" -maxdepth 1 -type d -name '*.*' -print -quit)
    ver_dir="${ver_dir:-$GEMS_DEST/3.4.0}"
    mkdir -p "$ver_dir"
    rsync -a "$CLEAN_GEMS/specifications/" "$ver_dir/specifications/"
    rsync -a "$CLEAN_GEMS/gems/" "$ver_dir/gems/" 2>/dev/null || true
    rsync -a "$CLEAN_GEMS/cache/" "$ver_dir/cache/" 2>/dev/null || true
    echo "== wasix-ruby: merged full gemspecs/gems from package-3-clean snapshot"
  fi
fi
# Host gate: refuse to stage without rake+bundler specs (acceptance needs them).
if ! find "$GEMS_DEST" -path '*/specifications/rake-*.gemspec' 2>/dev/null | grep -q .; then
  echo "PRESTAGE fail: missing rake gemspec under $GEMS_DEST" >&2
  exit 1
fi
if ! find "$GEMS_DEST" -path '*/specifications/*bundler*.gemspec' 2>/dev/null | grep -q .; then
  echo "PRESTAGE fail: missing bundler gemspec under $GEMS_DEST" >&2
  exit 1
fi
# Prefer full clean-3 *gems* tree when gemspecs are thin (partial DESTDIR install).
# Do NOT rsync the whole clean lib/ — that reintroduces lib/ruby/3.4.11 and can
# overwrite the API tree from this prefix.
CLEAN_LIB=/tmp/slicc-ruby-repro/package-3-clean/lib
CLEAN_GEMS="$CLEAN_LIB/ruby/gems/3.4.0"
if [[ -d "$CLEAN_GEMS/specifications" ]]; then
  pkg_gem_kb=$(du -sk "$DEST/lib/ruby/gems" 2>/dev/null | awk '{print $1}')
  clean_gem_kb=$(du -sk "$CLEAN_LIB/ruby/gems" | awk '{print $1}')
  pkg_gem_kb="${pkg_gem_kb:-0}"
  if [[ "$pkg_gem_kb" -lt $((clean_gem_kb * 80 / 100)) ]]; then
    echo "== wasix-ruby: gems ${pkg_gem_kb}KB < 80% of clean ${clean_gem_kb}KB — rsync clean gems only"
    mkdir -p "$DEST/lib/ruby/gems"
    rsync -a "$CLEAN_LIB/ruby/gems/" "$DEST/lib/ruby/gems/"
  fi
fi
# Re-drop any non-API version tree (guards clean/leak merges).
API_LIB=""
for d in "$DEST"/lib/ruby/[0-9]*; do
  [[ -f "$d/rubygems.rb" ]] || continue
  API_LIB="$d"
  break
done
if [[ -n "$API_LIB" ]]; then
  for d in "$DEST"/lib/ruby/[0-9]*; do
    [[ -d "$d" ]] || continue
    [[ "$d" == "$API_LIB" ]] && continue
    echo "== wasix-ruby: remove non-API lib tree $(basename "$d") (keeping $(basename "$API_LIB"))"
    rm -rf "$d"
  done
fi

homescoop_stage_license "$SRC/COPYING" "$SRC/BSDL" 2>/dev/null || \
  homescoop_stage_license "$SRC/COPYING" "$SRC/LEGAL"
homescoop_notices_begin "ruby.wasm statically links the following (ext/openssl, ext/zlib, ext/psych, and wasix-libc)."
homescoop_notice "OpenSSL 3.5.9 (@ai-ecoverse/wasix-openssl 3.5.9-2), Apache-2.0" "$OPENSSL_PREFIX/LICENSE" -
homescoop_notice "zlib 1.3.1 (@ai-ecoverse/wasix-zlib 1.3.1-2)" "$ZLIB_PREFIX/LICENSE" -
homescoop_notice "libyaml $YAML_VER, MIT" "$YAML_SRC/License" -
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2025-09-02.1
homescoop_notice "wasix-libc (@ai-ecoverse/wasix-sysroot 2025.9.30-17; files from tag v2025-09-02.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af \
  "$WLIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0

python3 - "$DEST" "$VER" "$PKG_VER" "$OPENSSL_NOTE" "$ASYNCIFY_BUF" <<'PY'
import json, sys
from pathlib import Path
dest, ver, pkg_ver, openssl_note, asyncify_buf = (
    Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
)
wasm = dest / "bin" / "ruby.wasm"
b = wasm.read_bytes()
if b"epoll_create (errno:%d)" in b or b"epoll_create (errno:" in b:
    raise SystemExit("PRESTAGE fail: ruby.wasm still contains epoll_create rb_bug — MN/epoll path compiled in")
if b.count(b"asyncify_start_unwind") < 1:
    raise SystemExit("PRESTAGE fail: ruby.wasm missing asyncify_start_unwind")
# date_core must be statically linked
if b"Date::Error" not in b and b"date_core" not in b and b"invalid date" not in b:
    raise SystemExit("PRESTAGE fail: ruby.wasm does not look like it linked date_core")
print("PRESTAGE static: no epoll_create rb_bug; asyncify ok; date strings present")
# SLICC default PATH is /usr/bin:/workspace/... — not the npm package bin.
# User gem bin first so gem/bundle executables are found by Ruby child processes.
# RUBYLIB must list every dir MRI's built-in $LOAD_PATH would have under prefix.
# Built-in paths use --prefix=/nonexistent-ruby-prefix and never match ipk install.
user_gem_home = "${HOME}/.local/share/gem/ruby/3.4.0"
path_env = f"{user_gem_home}/bin:" + "${package}/bin:${PATH}"
lib_ruby = dest / "lib" / "ruby"
api = None
for d in sorted(lib_ruby.iterdir()) if lib_ruby.is_dir() else []:
    if d.is_dir() and (d / "rubygems.rb").is_file():
        api = d.name
        break
if not api:
    raise SystemExit("PRESTAGE fail: no lib/ruby/<api>/rubygems.rb (expected API version tree e.g. 3.4.0)")
arch_name = None
for d in (lib_ruby / api).iterdir():
    if d.is_dir() and (d / "rbconfig.rb").is_file():
        arch_name = d.name
        break
if not arch_name:
    raise SystemExit(f"PRESTAGE fail: no rbconfig.rb under lib/ruby/{api}/<arch>/")
rubylib_parts = []
for rel in (
    f"lib/ruby/site_ruby/{api}",
    f"lib/ruby/site_ruby/{api}/{arch_name}",
    f"lib/ruby/vendor_ruby/{api}",
    f"lib/ruby/vendor_ruby/{api}/{arch_name}",
    f"lib/ruby/{api}",
    f"lib/ruby/{api}/{arch_name}",
):
    if (dest / rel).is_dir():
        rubylib_parts.append("${package}/" + rel)
rubylib = ":".join(rubylib_parts)
# User-writable gem home (SLICC HOME); package gems on GEM_PATH for bundled stdgems.
base_env = {
    "PATH": path_env,
    "RUBYLIB": rubylib,
    "GEM_HOME": user_gem_home,
}
pkg = {
    "name": "@ai-ecoverse/wasix-ruby",
    "version": pkg_ver,
    "description": f"MRI Ruby for slicc WASIX (no epoll; asyncify spill {asyncify_buf}; date_core; sysroot 2025.9.30-14)",
    "license": "Ruby",
    "files": ["README.md", "LICENSE", "THIRD-PARTY-NOTICES.md", "bin", "lib", "PRESTAGE.md"],
    "publishConfig": {"access": "public"},
    "homescoop": {
        "recipe": "wasix-ruby",
        "upstream": ver,
        "openssl": openssl_note,
        "asyncify_buf": asyncify_buf,
        "asyncify_note": (
            "POSTLINK: wasm-opt --asyncify only (no asyncify-ignore-imports, "
            "no restricted import list). Spill macros "
            f"WASM_{{SETJMP,FIBER,SCAN}}_STACK_BUFFER_SIZE={asyncify_buf} "
            "(upstream default 6144). No RB_WASM_ASYNCIFY symbol."
        ),
        "threads_note": (
            "pthread + Asyncify trampoline (WASIX_WASM_THREAD_RT); TLS Asyncify "
            "state. Certify Thread/Mutex/Queue at real ipk path for -4+."
        ),
        "relocation_note": (
            "configure --prefix=/nonexistent-ruby-prefix so baked-in load paths "
            "never match VFS. RUBYLIB lists site/vendor/api + arch (rbconfig). "
            "Certify at /shared/lib/node_modules/@ai-ecoverse/wasix-ruby with "
            "manifest env — never at /ruby."
        ),
        "slicc_pr_3735": (
            "gem/bundle/rake use args: [\"${package}/bin/…\"]; needs SLICC PR #3735 "
            "(absolute args). Until merged, those commands need a harness with the PR."
        ),
    },
    "slicc": {
        "abi": "wasi",
        "commands": {
            "ruby": {"wasm": "bin/ruby.wasm", "env": dict(base_env)},
        },
    },
}
for cand in (dest / "lib" / "ruby" / "gems").glob("*.*"):
    if cand.is_dir():
        package_gems = "${package}/" + str(cand.relative_to(dest))
        # GEM_HOME = user install dir; GEM_PATH = user : packaged gems
        pkg["slicc"]["commands"]["ruby"]["env"]["GEM_HOME"] = user_gem_home
        pkg["slicc"]["commands"]["ruby"]["env"]["GEM_PATH"] = f"{user_gem_home}:{package_gems}"
        break
env = pkg["slicc"]["commands"]["ruby"]["env"]
print("RUBYLIB=", env["RUBYLIB"])
print("GEM_HOME=", env.get("GEM_HOME"))
print("GEM_PATH=", env.get("GEM_PATH"))
# Absolute script args — needs SLICC PR #3735 for ${package} expansion in args.
for cmd in ("gem", "bundle", "rake"):
    script = dest / "bin" / cmd
    if script.is_file():
        pkg["slicc"]["commands"][cmd] = {
            "wasm": "bin/ruby.wasm",
            "args": ["${package}/bin/" + cmd],
            "env": dict(env),
        }
(dest / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")
(dest / "README.md").write_text(
    "# `@ai-ecoverse/wasix-ruby`\n\n"
    "MRI Ruby for slicc WASIX. No epoll (poll fallback). See PRESTAGE.md.\n\n"
    "## Gem executables on PATH\n\n"
    "Command env puts user gem bins ahead of the package:\n\n"
    "```text\n"
    "${HOME}/.local/share/gem/ruby/3.4.0/bin:${package}/bin:${PATH}\n"
    "```\n\n"
    "That covers Ruby child processes (`system`, `spawn`, `bundle exec`, …). "
    "To run those gems **by name from your shell**, add the same user gem bin "
    "directory to the host PATH, e.g. in `~/.bashrc`:\n\n"
    "```bash\n"
    "export PATH=\"$HOME/.local/share/gem/ruby/3.4.0/bin:$PATH\"\n"
    "```\n"
)
print("package.json", pkg["version"], "commands:", sorted(pkg["slicc"]["commands"]))
PY

cat > "$DEST/PRESTAGE.md" <<EOF
# wasix-ruby ${PKG_VER}

Built against wasix-sysroot **2025.9.30-14**. **No epoll**: SLICC returns ENOSYS (52)
for \`epoll_create\`; MRI is compiled with \`USE_MN_THREADS=0\` and
\`HAVE_SYS_EPOLL_H=0\` (also kqueue/eventfd/timerfd off) so it uses poll()/timer-thread.

Configure \`--prefix=${RUBY_PREFIX}\` so baked-in \`\$LOAD_PATH\` never matches a real
VFS path. Manifest \`RUBYLIB\` is authoritative.

## Asyncify (buffer sizing — priority over process/fork)

- **POSTLINK** (from configure \`wasi*\`): \`\$(WASMOPT) --asyncify \$(wasmoptflags)\`
  — **no** \`asyncify-ignore-imports\`, **no** restricted import list.
- Spill buffers \`WASM_{SETJMP,FIBER,SCAN}_STACK_BUFFER_SIZE=${ASYNCIFY_BUF}\`.

## OpenSSL
${OPENSSL_NOTE}

## Relocation / RUBYLIB
- Stdlib under \`lib/ruby/<API>\` (e.g. **3.4.0**), arch \`…/wasm32-wasi/rbconfig.rb\`.
- \`RUBYLIB\` = site_ruby + vendor_ruby + api (+ each \`/wasm32-wasi\`), all \`\${package}/…\`.
- **Certify only** at \`/shared/lib/node_modules/@ai-ecoverse/wasix-ruby\` with
  manifest env. Never at \`/ruby\` (hides missing RUBYLIB — -3 false pass).

## Gems / flock / uid (-5)
- \`GEM_HOME=\${HOME}/.local/share/gem/ruby/3.4.0\` (writable under SLICC HOME).
- \`GEM_PATH=\${HOME}/.local/share/gem/ruby/3.4.0:\${package}/lib/ruby/gems/3.4.0\`.
- \`File#flock\` / \`missing/flock.c\` \`__wasi__\`: advisory **no-op success** (was EINVAL).
- \`getuid\`/\`geteuid\`/\`getgid\`/\`getegid\` → **1000** via wasix-sysroot \`slicc_identity\`
  (injected into \`wasm32-wasi\` libc used by wasixcc, not only wasip1).

## Gems / PATH / SLICC #3735
- \`PATH=\${package}/bin:\${PATH}\`.
- \`gem\`/\`bundle\`/\`rake\` \`args: ["\${package}/bin/…"]\` need **SLICC PR #3735**.
  Until merged, those commands only work in harnesses that have it.

## PRESTAGE (host)
- no \`epoll_create (errno:\` in wasm; date_core linked; \`nt_start_wasm_trampoline\`
- package.json \`RUBYLIB\` contains \`wasm32-wasi\` and \`lib/ruby/3.4.0\`
- package.json \`GEM_HOME\` is under \`\${HOME}/.local/share/gem\`, not \`\${package}\`

## PRESTAGE (SLICC — real install path)
\`\`\`ruby
RUBY_VERSION
system("echo", "x")
IO.popen(["echo", "x"], &:read)
Process.spawn("echo", "x").then { Process.wait _1 }
require "json"; JSON.parse('{"a":1}')
require "zlib"; require "yaml"; require "date"; Date.today
Fiber.new { :ok }.resume
\$stdout.sync = true
t = Thread.new { puts "CHILD"; 42 }; puts t.value
require "openssl"; OpenSSL::OPENSSL_VERSION
require "socket"
Process.uid # => 1000
f = File.open("flock-test", "w"); f.flock(File::LOCK_EX); f.close # no Errno::EINVAL
\`\`\`
Plus Queue/CV/Mutex; \`bundle exec rake\` when #3735 is available.

## Install acceptance (-5) — certify at real VFS path only
At \`/shared/lib/node_modules/@ai-ecoverse/wasix-ruby\` with manifest env:
1. \`gem env home\` → \`…/.local/share/gem/ruby/3.4.0\` (not under package).
2. \`bundle install --local\` creates lockfile without \`Errno::EINVAL @ rb_file_flock\`.
3. \`gem install --local --force\` from packaged \`rake-13.2.1.gem\`; spec under
   \`HOME/.local/share/gem/ruby/3.4.0\`.
Hold npm publish until those three pass.
EOF
cp "$DEST/PRESTAGE.md" "$PKG/PRESTAGE.md"
cp "$PKG/THREADS.md" "$DEST/THREADS.md" 2>/dev/null || true

echo "== wasix-ruby staged $PKG_VER (prefix=$RUBY_PREFIX)"
ls -la "$DEST/bin"
du -sh "$DEST"
echo "openssl: $OPENSSL_NOTE"
