#!/usr/bin/env bash
# Cross-build OpenSSH portable client tools for slicc WASIX via wasixcc.
#
# v1 targets: ssh, ssh-keygen. scp/sftp/ssh-add only if they link cheaply.
# Links published wasix-openssl + wasix-zlib (pkg-config lib/ only) with
# -Wl,--fatal-warnings. Sysroot: wasix-sysroot 2025.9.30-17 (slicc_fs modes).
set -euo pipefail

HOMESCOOP_ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=/dev/null
source "$HOMESCOOP_ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-openssh

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
# Upstream portable tag is 10.6p1; npm packaging base is recipe 10.6.0.
UPSTREAM_PORTABLE="${HOMESCOOP_OPENSSH_PORTABLE:-10.6p1}"
PKG_VER="${VERSION}-1"
WORK="${WASIX_OPENSSH_WORK:-$PKG/.work}"
SRCS="$WORK/src"
BUILD="$WORK/build"
DEPS="$WORK/deps"
PREFIX="$WORK/prefix"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

OPENSSL_PREFIX="${WASIX_OPENSSL_PREFIX:-$DEPS/wasix-openssl/package}"
ZLIB_PREFIX="${WASIX_ZLIB_PREFIX:-$DEPS/wasix-zlib/package}"

if ! command -v wasixcc >/dev/null && [[ ! -x "${WASIXCC_PREFIX:-$HOME/.wasixcc}/bin/wasixcc" ]]; then
  eval "$(bash "$HOMESCOOP_ROOT/scripts/install-wasixcc.sh")"
fi
export PATH="${WASIXCC_PREFIX:-$HOME/.wasixcc}/bin:${WASIXCC_LLVM_LOCATION:-$HOME/.wasixcc/llvm}/bin:$HOME/.wasmer/bin:/opt/homebrew/bin:$PATH"
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS=no
export WASIXCC_PIC=no
export WASIXCC_MODULE_KIND=static-main
unset CFLAGS CPPFLAGS LDFLAGS CXX PKG_CONFIG_LIBDIR

command -v wasixcc >/dev/null || { echo "homescoop wasix-openssh: wasixcc not on PATH" >&2; exit 1; }
SYSROOT_LIBC="${WASIXCC_SYSROOT_PREFIX:-$HOME/.wasixcc/sysroot}/sysroot/lib/wasm32-wasi/libc.a"
llvm-ar t "$SYSROOT_LIBC" | grep -qx slicc_stat_owner.o || {
  echo "homescoop wasix-openssh: $SYSROOT_LIBC predates wasix-sysroot 2025.9.30-15 (no slicc_stat_owner.o)" >&2
  exit 1
}
SYSROOT_UNDEF="$(llvm-nm -u "$SYSROOT_LIBC" 2>/dev/null)"
grep -q __slicc_fs_fd_chmod <<<"$SYSROOT_UNDEF" || {
  echo "homescoop wasix-openssh: $SYSROOT_LIBC predates wasix-sysroot 2025.9.30-17 (no slicc_fs imports)" >&2
  exit 1
}

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) BUILD_TRIPLE=aarch64-apple-darwin ;;
  Darwin-x86_64) BUILD_TRIPLE=x86_64-apple-darwin ;;
  Linux-x86_64) BUILD_TRIPLE=x86_64-pc-linux-gnu ;;
  Linux-aarch64) BUILD_TRIPLE=aarch64-unknown-linux-gnu ;;
  *) echo "homescoop wasix-openssh: unsupported build host $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

mkdir -p "$SRCS" "$BUILD" "$PREFIX" "$DEPS"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRCS/openssh-$UPSTREAM_PORTABLE.tar.gz"

for dep in wasix_zlib wasix_openssl; do
  homescoop_load_recipe wasix-openssh --source "$dep"
  url_var="${dep^^}_SRC_URL"
  sha_var="${dep^^}_SRC_SHA"
  name="${dep//_/-}"
  if [[ ( "$name" == wasix-zlib && -z "${WASIX_ZLIB_PREFIX:-}" ) || ( "$name" == wasix-openssl && -z "${WASIX_OPENSSL_PREFIX:-}" ) ]]; then
    homescoop_fetch "${!url_var}" "${!sha_var}" "$WORK/$name.tgz"
    rm -rf "$DEPS/$name" && mkdir -p "$DEPS/$name"
    tar xzf "$WORK/$name.tgz" -C "$DEPS/$name"
  fi
done
test -f "$OPENSSL_PREFIX/lib/libssl.a" && test -f "$OPENSSL_PREFIX/include/openssl/ssl.h"
test -f "$ZLIB_PREFIX/lib/libz.a" && test -f "$ZLIB_PREFIX/include/zlib.h"

# Only the WASIX dev packages' .pc files — never host Homebrew OpenSSL/zlib.
export PKG_CONFIG_PATH="${OPENSSL_PREFIX}/lib/pkgconfig:${ZLIB_PREFIX}/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$PKG_CONFIG_PATH"
export PKG_CONFIG_SYSROOT_DIR=""

GDIR="openssh-$UPSTREAM_PORTABLE"
rm -rf "${BUILD:?}/$GDIR"
tar xzf "$SRCS/openssh-$UPSTREAM_PORTABLE.tar.gz" -C "$BUILD"
if [[ -d "$PKG/patches" ]]; then
  shopt -s nullglob
  for p in "$PKG/patches"/*.patch; do
    echo "== patch $(basename "$p")"
    patch -d "$BUILD/$GDIR" -p1 <"$p"
  done
  shopt -u nullglob
fi

# Stub headers for wasix-libc gaps. openbsd-compat/include is already on -I.
# resolv.h: OpenSSH only wants b64_ntop/b64_pton (also in openbsd-compat/base64).
# util.h: BSD libutil; OpenSSH has openbsd-compat replacements (bcrypt_pbkdf, …).
STUB_INC="$BUILD/$GDIR/openbsd-compat/include"
mkdir -p "$STUB_INC"
cat >"$STUB_INC/resolv.h" <<'EOF'
/* WASIX stub (homescoop wasix-openssh): no libresolv; use openbsd-compat base64. */
#ifndef HOMESCOOP_WASIX_RESOLV_H
#define HOMESCOOP_WASIX_RESOLV_H
#include <sys/types.h>
int b64_ntop(u_char const *src, size_t srclength, char *target, size_t targsize);
int b64_pton(char const *src, u_char *target, size_t targsize);
#endif
EOF
cat >"$STUB_INC/util.h" <<'EOF'
/* WASIX stub (homescoop wasix-openssh): no BSD libutil. */
#ifndef HOMESCOOP_WASIX_UTIL_H
#define HOMESCOOP_WASIX_UTIL_H
#endif
EOF
echo "== stub headers in openbsd-compat/include (resolv.h, util.h)"

# Configure cache overrides for WASIX (no setuid, no utmp, cross).
# Prefer poll/ppoll (OpenSSH 10.6 clientloop) over select.
CONF_CACHE=(
  ac_cv_func_getpwnam=yes
  ac_cv_func_getpwuid=yes
  ac_cv_func_asprintf=yes
  ac_cv_func_vasprintf=yes
  ac_cv_func_getgrouplist=no
  ac_cv_func_setresuid=no
  ac_cv_func_setresgid=no
  ac_cv_func_setreuid=no
  ac_cv_func_setregid=no
  ac_cv_func_setlogin=no
  ac_cv_func_endutent=no
  ac_cv_func_getutent=no
  ac_cv_func_openpty=yes
  # Headers may declare ppoll/getifaddrs/madvise; wasix-libc does not link them.
  ac_cv_func_ppoll=no
  ac_cv_func_poll=yes
  ac_cv_func_getifaddrs=no
  ac_cv_func_madvise=no
  ac_cv_header_ifaddrs_h=no
  ac_cv_have_decl_AI_NUMERICHOST=yes
  # WASIX msghdr may list msg_control but cmsghdr/SCM_RIGHTS are incomplete
  # (same as wasix-ruby). Client does not need fd passing.
  ac_cv_have_control_in_msghdr=no
  ac_cv_have_accrights_in_msghdr=no
)

(
  cd "$BUILD/$GDIR"
  # openssl.pc Requires both libssl and libcrypto; --with-ssl-dir alone can
  # pick host headers — force pkg-config paths via CPPFLAGS/LDFLAGS too.
  SSL_CFLAGS="$(pkg-config --cflags --static libssl libcrypto)"
  SSL_LIBS="$(pkg-config --libs --static libssl libcrypto)"
  Z_CFLAGS="$(pkg-config --cflags --static zlib)"
  Z_LIBS="$(pkg-config --libs --static zlib)"

  ./configure \
    --host=wasm32-unknown-wasi \
    --build="$BUILD_TRIPLE" \
    --prefix=/usr \
    --sysconfdir=/etc/ssh \
    --with-zlib="$ZLIB_PREFIX" \
    --with-ssl-dir="$OPENSSL_PREFIX" \
    --without-openssl-header-check \
    --without-stackprotect \
    --without-hardening \
    --without-rpath \
    --without-sandbox \
    --without-retpoline \
    --without-selinux \
    --without-kerberos5 \
    --without-libedit \
    --without-pam \
    --without-ldns \
    --without-security-key-builtin \
    --disable-strip \
    --disable-etc-default-login \
    --disable-utmp \
    --disable-wtmp \
    --disable-lastlog \
    --disable-pututline \
    --disable-pututxline \
    "${CONF_CACHE[@]}" \
    CC=wasixcc \
    AR=llvm-ar \
    RANLIB=llvm-ranlib \
    STRIP=llvm-strip \
    CFLAGS="-O2 $SSL_CFLAGS $Z_CFLAGS" \
    CPPFLAGS="$SSL_CFLAGS $Z_CFLAGS" \
    LDFLAGS="-Wl,--fatal-warnings $SSL_LIBS $Z_LIBS" \
    LIBS="$SSL_LIBS $Z_LIBS" \
    >"$BUILD/$GDIR.configure.log" 2>&1 || {
      echo "homescoop wasix-openssh: configure failed; last 80 lines:" >&2
      tail -n 80 "$BUILD/$GDIR.configure.log" >&2
      exit 1
    }

  # Client tools only (no sshd).
  TARGETS=(ssh ssh-keygen)
  if make -n scp >/dev/null 2>&1; then TARGETS+=(scp); fi
  if make -n sftp >/dev/null 2>&1; then TARGETS+=(sftp); fi
  if make -n ssh-add >/dev/null 2>&1; then TARGETS+=(ssh-add); fi

  # Cross-configure sometimes misses libc asprintf; wasix-musl has it.
  for def in HAVE_ASPRINTF HAVE_VASPRINTF; do
    if grep -q "^/\\* #undef ${def} \\*/$" config.h 2>/dev/null; then
      sed -i.bak "s|^/\\* #undef ${def} \\*/\$|#define ${def} 1|" config.h
      echo "== config.h: force #define ${def} 1"
    fi
  done
  # Belt-and-braces: never compile SCM_RIGHTS paths on WASIX.
  for def in HAVE_CONTROL_IN_MSGHDR HAVE_ACCRIGHTS_IN_MSGHDR HAVE_PPOLL HAVE_IFADDRS_H HAVE_GETIFADDRS MADV_DONTDUMP; do
    if grep -qE "^#define ${def}(\s|\$)" config.h 2>/dev/null; then
      sed -i.bak "s|^#define ${def}.*$|/* #undef ${def} */|" config.h
      echo "== config.h: undef ${def}"
    fi
  done

  # Link stubs for symbols configure still enables (mmap+MADV path, etc.).
  wasixcc -O2 -c -o "$BUILD/wasix-stubs.o" "$PKG/wasix-stubs.c"
  # Inject into LIBS so every client link picks them up.
  if ! grep -q wasix-stubs.o Makefile; then
    sed -i.bak "s|^LIBS=\\(.*\\)|LIBS= $BUILD/wasix-stubs.o \\1|" Makefile
  fi

  make -j"$JOBS" "${TARGETS[@]}" >"$BUILD/$GDIR.make.log" 2>&1 || {
    echo "homescoop wasix-openssh: make failed; errors:" >&2
    grep -E 'error:|fatal error|undefined reference|Error [0-9]' "$BUILD/$GDIR.make.log" | tail -n 60 >&2 || true
    echo "homescoop wasix-openssh: make log tail:" >&2
    tail -n 120 "$BUILD/$GDIR.make.log" >&2
    exit 1
  }
) || exit 1

rm -rf "$DEST/bin" "$DEST/licenses" "$DEST/patches"
mkdir -p "$DEST/bin" "$DEST/licenses"
for b in ssh ssh-keygen scp sftp ssh-add; do
  if [[ -f "$BUILD/$GDIR/$b" ]]; then
    cp "$BUILD/$GDIR/$b" "$DEST/bin/${b}.wasm"
  fi
done
test -f "$DEST/bin/ssh.wasm" || { echo "homescoop wasix-openssh: ssh.wasm missing" >&2; exit 1; }
test -f "$DEST/bin/ssh-keygen.wasm" || { echo "homescoop wasix-openssh: ssh-keygen.wasm missing" >&2; exit 1; }

# Host-artefact check: no ELF/Mach-O, no host path strings in wasm.
python3 - "$DEST" <<'PY'
import pathlib, sys
dest = pathlib.Path(sys.argv[1])
magics = (
    b"\x7fELF",
    b"\xcf\xfa\xed\xfe",
    b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
    b"\xfe\xed\xfa\xce",
    b"\xca\xfe\xba\xbe",
)
host_needles = (b"/opt/homebrew/", b"/usr/local/opt/", b"/Users/", b"C:\\")
for p in dest.rglob("*"):
    if not p.is_file():
        continue
    data = p.read_bytes()
    for m in magics:
        if data.startswith(m):
            raise SystemExit(f"homescoop wasix-openssh: host binary leaked: {p}")
    if p.suffix == ".wasm" or p.name.endswith(".wasm"):
        for n in host_needles:
            if n in data:
                raise SystemExit(f"homescoop wasix-openssh: host path {n!r} in {p}")
print("host-artefact check: no ELF/Mach-O, no obvious host paths in wasm")
PY

homescoop_stage_license "$BUILD/$GDIR/LICENCE"
cp "$BUILD/$GDIR/LICENCE" "$DEST/licenses/openssh-LICENCE"
if [[ -d "$PKG/patches" ]]; then
  shopt -s nullglob
  patches=("$PKG/patches"/*.patch)
  if ((${#patches[@]})); then
    mkdir -p "$DEST/patches"
    cp "${patches[@]}" "$DEST/patches/"
  fi
  shopt -u nullglob
fi

homescoop_notices_begin "The ssh and ssh-keygen (and optional scp/sftp/ssh-add) wasm modules statically link OpenSSL and zlib from the published WASIX dev packages and the wasix libc."
homescoop_notice "OpenSSL 3.5.9 (@ai-ecoverse/wasix-openssl 3.5.9-3), Apache-2.0" "$OPENSSL_PREFIX/LICENSE" -
homescoop_notice "zlib 1.3.1 (@ai-ecoverse/wasix-zlib 1.3.1-2)" "$ZLIB_PREFIX/LICENSE" -
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2025-09-02.1
homescoop_notice "wasix-libc (@ai-ecoverse/wasix-sysroot 2025.9.30-17; files from tag v2025-09-02.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af \
  "$WLIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0

{
  echo "# Sources"
  echo
  echo "Upstream tarball (OpenBSD portable), with \`patches/\` applied when present:"
  echo
  echo "| tarball | sha256 |"
  echo "| --- | --- |"
  echo "| openssh-$UPSTREAM_PORTABLE.tar.gz | \`$SRC_SHA\` |"
  echo "| @ai-ecoverse/wasix-openssl 3.5.9-3 | (recipe sources.wasix_openssl) |"
  echo "| @ai-ecoverse/wasix-zlib 1.3.1-2 | (recipe sources.wasix_zlib) |"
  echo
  echo "Build recipe: https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-openssh"
} >"$DEST/SOURCES.md"

CMDS_JSON=$(python3 - "$DEST" <<'PY'
import json, pathlib
dest = pathlib.Path(__import__("sys").argv[1])
cmds = {}
for name in ("ssh", "ssh-keygen", "scp", "sftp", "ssh-add"):
    wasm = dest / "bin" / f"{name}.wasm"
    if wasm.is_file():
        cmds[name] = {"wasm": f"bin/{name}.wasm"}
print(json.dumps(cmds))
PY
)

python3 - "$DEST" "$VERSION" "$PKG_VER" "$UPSTREAM_PORTABLE" "$CMDS_JSON" <<'PY'
import json, sys
from pathlib import Path
dest, ver, pkg_ver, portable, cmds_json = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5]
cmds = json.loads(cmds_json)
assert "ssh" in cmds and "ssh-keygen" in cmds
files = ["README.md", "LICENSE", "THIRD-PARTY-NOTICES.md", "SOURCES.md", "bin", "licenses"]
if (dest / "patches").is_dir():
    files.append("patches")
pkg = {
    "name": "@ai-ecoverse/wasix-openssh",
    "version": pkg_ver,
    "description": f"OpenSSH {portable} client for slicc WASIX: " + ", ".join(sorted(cmds)),
    "license": "SSH-OpenSSH",
    "repository": {
        "type": "git",
        "url": "git+https://github.com/ai-ecoverse/homescoop.git",
        "directory": "packages/wasix-openssh/package",
    },
    "homepage": "https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-openssh",
    "keywords": ["wasm", "wasix", "slicc", "homescoop", "openssh", "ssh"],
    "files": files,
    "publishConfig": {"access": "public"},
    "homescoop": {
        "recipe": "wasix-openssh",
        "upstream": portable,
        "openssl": "@ai-ecoverse/wasix-openssl@3.5.9-3",
        "zlib": "@ai-ecoverse/wasix-zlib@1.3.1-2",
        "sysroot": "@ai-ecoverse/wasix-sysroot@2025.9.30-17",
    },
    "slicc": {"abi": "wasi", "commands": cmds},
}
(dest / "package.json").write_text(json.dumps(pkg, indent=2) + "\n")
print("package.json", pkg_ver, sorted(cmds))
PY

# README lives in package/ already (DEST); keep a copy at the recipe root in sync.
if [[ -f "$PKG/README.md" && "$PKG/README.md" -ef "$DEST/README.md" ]]; then
  :
elif [[ -f "$PKG/README.md" ]]; then
  cp "$PKG/README.md" "$DEST/README.md"
fi

echo "== wasix-openssh staged $PKG_VER"
ls -la "$DEST/bin"
