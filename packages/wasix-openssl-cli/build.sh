#!/usr/bin/env bash
# wasix-openssl-cli: OpenSSL's openssl command for slicc WASIX.
#
# - Built from the OpenSSL release tarball with the pinned wasixcc, as a
#   static-main module on the asyncify tree's libc (no wasm exceptions, no
#   PIC), but without asyncify: nothing in the command forks or longjmps.
# - No threads, engines, DSO or async jobs: the module imports no
#   thread_spawn, and its memory is the recipe's wasm.initial-memory, well
#   under a Cloudflare Dynamic Worker's 128 MB.
# - Sockets are WASIX's (sock_open, connect, resolve), so s_client and
#   s_server use the kernel's loopback and its uplink, and fail with
#   ENETUNREACH where nothing routes.
# - The package carries upstream's apps/openssl.cnf and Mozilla's roots
#   (curl's cacert bundle, as one file and as a hashed directory).
set -euo pipefail

HOMESCOOP_ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
# shellcheck source=/dev/null
source "$HOMESCOOP_ROOT/scripts/build-common.sh"
homescoop_load_recipe wasix-openssl-cli
homescoop_load_recipe wasix-openssl-cli --source roots
homescoop_load_recipe wasix-openssl-cli --source mpl

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
PKG_VER="$(node -p "require('$DEST/package.json').version")"
[[ "$PKG_VER" == "$VERSION-"* ]] || { echo "homescoop wasix-openssl-cli: package.json version $PKG_VER is not $VERSION-N" >&2; exit 1; }
WORK="${WASIX_OPENSSL_CLI_WORK:-$PKG/.work}"
SRCS="$WORK/src"
BLD="$WORK/openssl-$VERSION"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)}"

# wasix-sysroot -44, the newest: install-wasixcc's default is older. Literal
# values, so cert-review's input rule can read them; they must match the
# recipe's toolchain.wasix_sysroot.
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-44
export HOMESCOOP_WASIX_SYSROOT_SHA=baccd02c2914f1378889d308eb6d805d60637ee16e693100fcb7d22cddbbf240
field() { node "$HOMESCOOP_ROOT/scripts/read-recipe.mjs" wasix-openssl-cli --field "$1"; }
[[ "$HOMESCOOP_WASIX_SYSROOT_VERSION" == "$(field toolchain.wasix_sysroot)" && "$HOMESCOOP_WASIX_SYSROOT_SHA" == "$(field toolchain.wasix_sysroot_sha256)" ]] \
  || { echo "homescoop wasix-openssl-cli: build.sh's wasix-sysroot pin isn't recipe.yaml's toolchain.wasix_sysroot" >&2; exit 1; }
eval "$(bash "$HOMESCOOP_ROOT/scripts/install-wasixcc.sh" "${WASIX_OPENSSL_CLI_WASIXCC:-$WORK/wasixcc-$HOMESCOOP_WASIX_SYSROOT_VERSION}")"
SYSROOT_VER="$(node -p "require(process.argv[1]).version" "$WASIXCC_SYSROOT_PREFIX/package.json")"
[[ "$SYSROOT_VER" == "$HOMESCOOP_WASIX_SYSROOT_VERSION" ]] || { echo "homescoop wasix-openssl-cli: installed wasix-sysroot $SYSROOT_VER, not $HOMESCOOP_WASIX_SYSROOT_VERSION" >&2; exit 1; }
export PATH="${WASIXCC_PREFIX}/bin:${WASIXCC_LLVM_LOCATION}/bin:$PATH"
export WASIXCC_RUN_WASM_OPT=no
export WASIXCC_WASM_EXCEPTIONS=no
export WASIXCC_PIC=no
export WASIXCC_MODULE_KIND=static-main
export ZERO_AR_DATE=1
unset CFLAGS CPPFLAGS LDFLAGS CXX CXXFLAGS LIBS CPATH C_INCLUDE_PATH LIBRARY_PATH SDKROOT
command -v wasixcc >/dev/null
# The hashed root directory needs subject hashes; the host's openssl gives
# them (the cert checks each name against the built command's -hash).
command -v openssl >/dev/null || { echo "homescoop wasix-openssl-cli: no host openssl for the roots' subject hashes" >&2; exit 1; }
: "${WASM_INITIAL_MEMORY:?recipe.yaml wasm.initial-memory}"

# Reproducible libcrypto: util/mkbuildinf.pl writes OpenSSL_version(
# OPENSSL_BUILT_ON) from SOURCE_DATE_EPOCH, else the build time. Pinned to
# the OpenSSL 3.5.9 release (GitHub release openssl-3.5.9, published
# 2026-09-29T14:10:08Z), as in wasix-openssl; change it with the version.
export SOURCE_DATE_EPOCH=1790691008
BUILT_ON="built on: Tue Sep 29 14:10:08 2026 UTC"

mkdir -p "$SRCS"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$SRCS/openssl-$VERSION.tar.gz"
ROOTS_PEM="$SRCS/cacert-$ROOTS_VERSION.pem"
homescoop_fetch "$ROOTS_URL" "$ROOTS_SHA" "$ROOTS_PEM"

rm -rf "$BLD" && mkdir -p "$BLD"
tar xzf "$SRCS/openssl-$VERSION.tar.gz" -C "$BLD" --strip-components=1
for p in "$PKG"/patches/*.patch; do
  echo "== patch $(basename "$p")"
  patch -d "$BLD" -p1 --no-backup-if-mismatch <"$p"
done

# Configure options:
#   no-threads      the kernel can't start one where opspile runs it
#   no-shared no-dso no-engine   one static module, nothing loaded at run time
#   no-async        no ucontext stack switching on wasm
#   no-asm no-secure-memory no-afalgeng   no assembler, mlock or AF_ALG on WASIX
# Defines:
#   HAVE_FORK=0     speed -multi and the ocsp/cmp HTTP daemon would fork
#   NO_RECVMMSG NO_RECVMSG   BIO_dgram on recvfrom: WASIX has no CMSG macros
echo "== wasix-openssl-cli: Configure (initial memory $WASM_INITIAL_MEMORY bytes, WASIXCC_LINKER_FLAGS=${WASIXCC_LINKER_FLAGS:-})"
(
  cd "$BLD"
  CC=wasixcc AR=wasixar RANLIB=wasixranlib NM=wasixnm \
  CFLAGS="-O2 -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS" \
    ./Configure linux-generic32 no-shared no-pic no-asm no-dso no-threads no-engine no-async \
      no-secure-memory no-afalgeng no-tests no-docs \
      --prefix=/usr --openssldir=/etc/ssl \
      -DUSE_TIMEGM -DHAVE_FORK=0 -DNO_RECVMMSG -DNO_RECVMSG >"$WORK/configure.log" 2>&1 \
    || { tail -40 "$WORK/configure.log" >&2; exit 1; }
  disabled="$(perl configdata.pm -d | sed -n '/^Disabled features:/,/^Config target/p' | grep -E '^ +[a-z]' | awk '{print $1}' | tr '\n' ' ')"
  echo "   disabled: $disabled"
  for f in threads shared dso engine async; do
    [[ " $disabled " == *" $f "* ]] || { echo "homescoop wasix-openssl-cli: Configure left $f on" >&2; exit 1; }
  done
  for f in sock dgram tls1_3 dtls ec ocsp cms ct srp; do
    [[ " $disabled " != *" $f "* ]] || { echo "homescoop wasix-openssl-cli: Configure turned $f off" >&2; exit 1; }
  done
  make build_generated >/dev/null
  grep -q '^#  define OPENSSL_THREADS$' include/openssl/configuration.h \
    && { echo "homescoop wasix-openssl-cli: configuration.h defines OPENSSL_THREADS" >&2; exit 1; }
  make -j"$JOBS" build_programs >"$WORK/make.log" 2>&1 \
    || { grep -E 'error:|undefined symbol' "$WORK/make.log" | head -40 >&2; tail -20 "$WORK/make.log" >&2; exit 1; }
)
WASM="$BLD/apps/openssl"
[[ "$(head -c 4 "$WASM" | od -An -tx1 | tr -d ' \n')" == 0061736d ]] || { echo "homescoop wasix-openssl-cli: apps/openssl is not a wasm module" >&2; exit 1; }

rm -rf "$DEST/bin" "$DEST/etc" "$DEST/licenses" "$DEST/patches"
mkdir -p "$DEST/bin" "$DEST/etc/ssl/certs" "$DEST/licenses" "$DEST/patches"
cp "$WASM" "$DEST/bin/openssl.wasm"
chmod 0755 "$DEST/bin/openssl.wasm"

# The module: no build paths, the slicc.libc marker, the pinned build date,
# no thread_spawn import, and the recipe's initial memory.
python3 - "$DEST/bin/openssl.wasm" "$WORK" "$HOMESCOOP_ROOT" "$SYSROOT_VER" "$WASM_INITIAL_MEMORY" "$BUILT_ON" <<'PY'
import sys
from pathlib import Path
wasm, work, root, sysroot, initial, built_on = Path(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]), sys.argv[6]
d = wasm.read_bytes()
for needle in (work.encode(), root.encode(), b"/opt/homebrew/", b"/home/runner/", b"/Users/", b"homescoop-rebuild"):
    if needle in d:
        raise SystemExit(f"homescoop wasix-openssl-cli: openssl.wasm names a build path: {needle!r}")
for s in (f"wasix-sysroot {sysroot}".encode(), built_on.encode(), b"OpenSSL 3.5"):
    if s not in d:
        raise SystemExit(f"homescoop wasix-openssl-cli: openssl.wasm lacks {s!r}")
p = 8
def leb():
    global p
    r = s = 0
    while True:
        b = d[p]; p += 1; r |= (b & 0x7F) << s; s += 7
        if b < 0x80:
            return r
def name():
    global p
    n = leb(); v = d[p:p + n].decode(); p += n
    return v
memory = None
imports = []
while p < len(d):
    sid = d[p]; p += 1
    n = leb(); end = p + n
    if sid == 2:
        for _ in range(leb()):
            mod, nm = name(), name()
            kind = d[p]; p += 1
            if kind == 0:
                leb(); imports.append(f"{mod}.{nm}")
            elif kind == 1:
                p += 1; fl = d[p]; p += 1; leb()
                if fl & 1: leb()
            elif kind == 2:
                fl = d[p]; p += 1; ini = leb(); mx = leb() if fl & 1 else None
                memory = (mod, nm, fl, ini, mx)
            elif kind == 3:
                p += 2
    p = end
threads = [i for i in imports if "thread_spawn" in i or i.startswith("wasi.")]
if threads:
    raise SystemExit(f"homescoop wasix-openssl-cli: openssl.wasm imports {threads}")
if memory is None or memory[3] * 65536 != initial:
    raise SystemExit(f"homescoop wasix-openssl-cli: openssl.wasm's initial memory is {memory and memory[3]} pages, not {initial // 65536} (recipe.yaml wasm.initial-memory)")
print(f"openssl.wasm: {len(d)} bytes, {len(imports)} imports, none for threads; memory {memory[0]}.{memory[1]} {memory[3]} pages ({memory[3] * 64 // 1024} MiB), shared={bool(memory[2] & 2)}; slicc.libc wasix-sysroot {sysroot}")
PY

# etc/ssl: upstream's openssl.cnf (OPENSSL_CONF, for req, ca and x509
# -extfile sections), Mozilla's roots as one bundle (cert.pem, for -CAfile)
# and as an OpenSSL hashed directory (certs/<subject hash>.<n>, which
# SSL_CERT_DIR names). Regular files only: npm refuses links.
cp "$BLD/apps/openssl.cnf" "$DEST/etc/ssl/openssl.cnf"
cp "$ROOTS_PEM" "$DEST/etc/ssl/cert.pem"
ROOTS_COUNT="$(python3 - "$ROOTS_PEM" "$DEST/etc/ssl/certs" <<'PY'
import re, subprocess, sys
from pathlib import Path
pem = Path(sys.argv[1]).read_text(encoding="utf-8")
out = Path(sys.argv[2])
blocks = re.findall(r"-----BEGIN CERTIFICATE-----\n.*?-----END CERTIFICATE-----\n", pem, re.S)
seen = {}
for block in blocks:
    h = subprocess.run(["openssl", "x509", "-noout", "-subject_hash"], input=block.encode(), capture_output=True, check=True).stdout.decode().strip()
    if not re.fullmatch(r"[0-9a-f]{8}", h):
        raise SystemExit(f"homescoop wasix-openssl-cli: host openssl gave subject hash {h!r}")
    n = seen.get(h, 0)
    seen[h] = n + 1
    (out / f"{h}.{n}").write_text(block, encoding="utf-8")
print(len(blocks))
PY
)"
(( ROOTS_COUNT > 100 )) || { echo "homescoop wasix-openssl-cli: only $ROOTS_COUNT roots in $ROOTS_PEM" >&2; exit 1; }
find "$DEST/etc" -type f -exec chmod 0644 {} +

cp "$PKG"/patches/*.patch "$DEST/patches/"
homescoop_stage_license "$BLD/LICENSE.txt"
homescoop_notices_begin "bin/openssl.wasm is OpenSSL $VERSION (LICENSE, Apache-2.0), linked statically with wasix-libc. etc/ssl/cert.pem and etc/ssl/certs/ are Mozilla's root store."
WLIBC=https://raw.githubusercontent.com/wasix-org/wasix-libc/v2026-07-03.1
homescoop_notice "wasix-libc (@ai-ecoverse/wasix-sysroot $SYSROOT_VER; files from tag v2026-07-03.1)" \
  "$WLIBC/LICENSE" da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0 \
  "$WLIBC/LICENSE-APACHE-LLVM" 268872b9816f90fd8e85db5a28d33f8150ebb8dd016653fb39ef1f94f2686bc5 \
  "$WLIBC/LICENSE-MIT" 23f18e03dc49df91622fe2a76176497404e46ced8a715d9d2b67a7446571cca3 \
  "$WLIBC/libc-top-half/musl/COPYRIGHT" f9bc4423732350eb0b3f7ed7e91d530298476f8fec0c6c427a1c04ade22655af \
  "$WLIBC/libc-bottom-half/cloudlibc/LICENSE" c8b789cf5a746611e6300a0cc7750dbf92b61912a709d04e639245f7290656d0
printf '\n## Mozilla CA certificate store, as curl publishes it (cacert-%s.pem)\n\n%s\n' \
  "$ROOTS_VERSION" "Source: $ROOTS_URL (sha256 $ROOTS_SHA). etc/ssl/cert.pem is the file as published; etc/ssl/certs/ holds its $ROOTS_COUNT certificates one per file, named by subject hash, unmodified otherwise. Licence: MPL-2.0, from Mozilla's NSS (certdata.txt); its text follows." \
  >>"$HOMESCOOP_NOTICES"
homescoop_notice "Mozilla Public License 2.0" "$MPL_URL" "$MPL_SHA"
cp "$BLD/LICENSE.txt" "$DEST/licenses/openssl-LICENSE.txt"

{
  echo "# Sources"
  echo
  echo "| source | sha256 |"
  echo "| --- | --- |"
  echo "| $SRC_URL | \`$SRC_SHA\` |"
  echo "| $ROOTS_URL | \`$ROOTS_SHA\` |"
  echo
  echo "Toolchain: wasixcc with @ai-ecoverse/wasix-sysroot $SYSROOT_VER. \`patches/\` are applied to the OpenSSL tree."
  echo
  echo "Build recipe: https://github.com/ai-ecoverse/homescoop/tree/main/packages/wasix-openssl-cli"
} >"$DEST/SOURCES.md"

# package.json is committed; the build checks the fields it depends on.
node - "$DEST/package.json" "$SYSROOT_VER" "$VERSION" "$ROOTS_VERSION" <<'JS'
const [file, sysroot, upstream, roots] = process.argv.slice(2);
const pkg = require(file);
const want = {
  'slicc.abi': [pkg.slicc?.abi, 'wasi'],
  'slicc.commands.openssl.wasm': [pkg.slicc?.commands?.openssl?.wasm, 'bin/openssl.wasm'],
  'slicc.env.OPENSSL_CONF': [pkg.slicc?.env?.OPENSSL_CONF, 'etc/ssl/openssl.cnf'],
  'slicc.env.SSL_CERT_DIR': [pkg.slicc?.env?.SSL_CERT_DIR, 'etc/ssl/certs'],
  'homescoop.upstream': [pkg.homescoop?.upstream, upstream],
  'homescoop.sysroot': [pkg.homescoop?.sysroot, `@ai-ecoverse/wasix-sysroot@${sysroot}`],
  'homescoop.roots': [pkg.homescoop?.roots, `curl cacert-${roots}.pem`],
};
const bad = Object.entries(want).filter(([, [got, exp]]) => got !== exp);
if (bad.length) {
  console.error(`homescoop wasix-openssl-cli: package.json: ${bad.map(([k, [g, e]]) => `${k} is ${JSON.stringify(g)}, not ${JSON.stringify(e)}`).join('; ')}`);
  process.exit(1);
}
JS

[[ ! -e "$PKG/README.md" ]] || { echo "homescoop wasix-openssl-cli: $PKG/README.md exists; the package README is package/README.md only (homescoop#1446)" >&2; exit 1; }
homescoop_assert_no_package_links "$DEST"
echo "== wasix-openssl-cli: staged $PKG_VER: bin/openssl.wasm $(wc -c <"$DEST/bin/openssl.wasm" | tr -d ' ') bytes, $ROOTS_COUNT roots"
