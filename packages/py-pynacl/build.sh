#!/usr/bin/env bash
# py-pynacl: PyNaCl's nacl._sodium as a wasix-python 3.15 side module,
# statically linked with @ai-ecoverse/wasix-libsodium (SODIUM_INSTALL=system).
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
source "$ROOT/scripts/build-common.sh"
homescoop_load_recipe py-pynacl

PKG="$HOMESCOOP_PKG"
DEST="$PKG/package"
B="$WORK/py-pynacl-$VERSION"
DL="$B/dl"
JOBS="${HOMESCOOP_JOBS:-$(nproc 2>/dev/null || sysctl -n hw.ncpu)}"
# PyNaCl 1.6.2's sdist upload to PyPI (2026-01-01T17:48:10Z); change it with the version.
export SOURCE_DATE_EPOCH=1767289690 PYTHONHASHSEED=0 ZERO_AR_DATE=1
mkdir -p "$DL"

fetch_src() {
  local name=$1 url_var sha_var
  homescoop_load_recipe py-pynacl --source "$name"
  url_var="${name^^}_SRC_URL"
  sha_var="${name^^}_SRC_SHA"
  SRC_FILE="$DL/$(basename "${!url_var}")"
  homescoop_fetch "${!url_var}" "${!sha_var}" "$SRC_FILE"
}
homescoop_load_recipe py-pynacl
NACL_TGZ="$DL/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$NACL_TGZ"

HOSTPY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOSTPY" ]] && command -v python3.15 >/dev/null 2>&1; then
  HOSTPY="$(command -v python3.15)"
fi
if [[ -z "$HOSTPY" ]]; then
  HOSTPY="$B/host/bin/python3.15"
  if [[ ! -x "$HOSTPY" ]]; then
    echo "== py-pynacl: host CPython 3.15.0 (compileall)"
    fetch_src cpython
    rm -rf "$B/host-src" && mkdir -p "$B/host-src"
    tar xzf "$SRC_FILE" -C "$B/host-src" --strip-components=1
    (
      cd "$B/host-src"
      unset CC CXX CFLAGS CXXFLAGS LDFLAGS CPPFLAGS
      ./configure --prefix="$B/host" --without-ensurepip --disable-test-modules \
        py_cv_module__ssl=n/a py_cv_module__hashlib=n/a >"$B/host-configure.log" 2>&1
      make -j"$JOBS" >"$B/host-make.log" 2>&1
      make install >"$B/host-install.log" 2>&1
    ) || { tail -40 "$B"/host-*.log >&2; exit 1; }
  fi
fi
"$HOSTPY" -c 'import sys; assert sys.version_info[:2] == (3, 15), sys.version'
export WASIX_PYTHON_HOST_PY="$HOSTPY"

# wasix-sysroot -38, as wasix-python 3.15.0-1 (the headers' python).
export HOMESCOOP_WASIX_SYSROOT_VERSION=2025.9.30-38
export HOMESCOOP_WASIX_SYSROOT_SHA=1fb57c95d84e7b33a5a535561a0d536c943c40fefd70991f9570db8e27994574
eval "$(bash "$ROOT/scripts/install-wasixcc.sh" "$B/wasixcc")"
export WASIXCC_WASM_EXCEPTIONS=legacy WASIXCC_PIC=yes WASIXCC_RUN_WASM_OPT=no
unset CC CXX CFLAGS CXXFLAGS CPPFLAGS LDFLAGS LIBS WASIXCC_MODULE_KIND

fetch_src wasix_python
PYDEV="$B/wasix-python"
rm -rf "$PYDEV" && mkdir -p "$PYDEV"
tar xzf "$SRC_FILE" -C "$PYDEV" package/include package/package.json package/bin/python.wasm
PYINC="$PYDEV/package/include/python3.15"
test -f "$PYINC/Python.h"
PYVER="$(node -p "require('$PYDEV/package/package.json').version")"
FLOOR="$(node --input-type=module -e "import { pythonRange } from '$ROOT/scripts/check-exact-pins.mjs'; import { readFileSync } from 'node:fs'; const r = pythonRange(JSON.parse(readFileSync('$DEST/package.json', 'utf8')).dependencies['@ai-ecoverse/wasix-python']); console.log(r ? r.floor : '')")"
[[ "$PYVER" == "$FLOOR" ]] || { echo "homescoop py-pynacl: headers from wasix-python $PYVER, but the package's range floor is '$FLOOR'" >&2; exit 1; }

fetch_src wasix_libsodium
SODEV="$B/wasix-libsodium"
rm -rf "$SODEV" && mkdir -p "$SODEV"
tar xzf "$SRC_FILE" -C "$SODEV"
SODIUM="$SODEV/package"
test -f "$SODIUM/include/sodium.h" && test -f "$SODIUM/lib-pic/libsodium.a"
SODIUM_VER="$(node -p "require('$SODIUM/package.json').homescoop.upstream")"

SRC="$B/pynacl-$VERSION"
rm -rf "$SRC"
tar xzf "$NACL_TGZ" -C "$B"
homescoop_apply_patches "$SRC"

# nacl/_sodium.c from PyNaCl's own src/bindings/build.py, by py-cffi's
# cffi: scripts/cffi-wasix.sh fetches the cffi sdist and pycparser wheel that
# packages/py-cffi and packages/py-pycparser pin and runs the generator on
# cffi's ctypes backend, so the C matches the _cffi_backend it runs on. The
# host CPython built above may lack _ctypes; any python3 with it will do.
for p in "$HOSTPY" "$(command -v python3 || true)"; do
  if [[ -n "$p" ]] && "$p" -c 'import ctypes' 2>/dev/null; then export HOMESCOOP_CFFI_HOST_PY="$p"; break; fi
done
[[ -n "${HOMESCOOP_CFFI_HOST_PY:-}" ]] || { echo "homescoop py-pynacl: no host python with ctypes for cffi's generator" >&2; exit 1; }
source "$ROOT/scripts/cffi-wasix.sh"
homescoop_cffi_host "$B/cffi-host"
CFFI_PIN="$(node -p "require('$DEST/package.json').dependencies['@ai-ecoverse/py-cffi']")"
[[ "$CFFI_PIN" == ">=$CFFI_HOST_VERSION-"*" <"* ]] \
  || { echo "homescoop py-pynacl: generated with cffi $CFFI_HOST_VERSION, but the package takes py-cffi $CFFI_PIN" >&2; exit 1; }
GEN="$B/gen"
rm -rf "$GEN" && mkdir -p "$GEN"
homescoop_cffi_emit "$SRC/src/bindings/build.py:ffi" "$GEN/_sodium.c"
grep -q 'PyInit__sodium' "$GEN/_sodium.c"
grep -q '#include <sodium.h>' "$GEN/_sodium.c"

SITE="$DEST/lib/python3.15/site-packages"
rm -rf "$DEST/lib"
mkdir -p "$SITE"
cp -R "$SRC/src/nacl" "$SITE/nacl"
find "$SITE/nacl" -name '__pycache__' -prune -exec rm -rf {} +
SO="$SITE/nacl/_sodium.cpython-315-wasm32-wasix.so"
echo "== py-pynacl: nacl/_sodium side module (libsodium $SODIUM_VER, lib-pic)"
# PIC, legacy EH, shared-library (python.wasm's variant); the static PIC
# libsodium goes into the link.
CFFI_WASIX_PYINC="$PYINC" homescoop_cffi_ext "$SO" "$GEN/_sodium.c" -I"$SODIUM/include" "$SODIUM/lib-pic/libsodium.a"
rm -f "${SO%.so}.o"

# --allow-undefined leaves every missing symbol to the dynamic linker:
# each function the side module imports must be one python.wasm exports
# (libc, CPython's C API), or dlopen fails in the kernel.
node - "$SO" "$PYDEV/package/bin/python.wasm" <<'JS'
const { readFileSync } = require('node:fs');
const [so, py] = process.argv.slice(2);
const imp = WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(so)));
const exp = new Set(WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(py))).map((e) => e.name));
const fns = imp.filter((i) => i.kind === 'function' && i.module === 'env');
const missing = fns.filter((i) => !exp.has(i.name)).map((i) => i.name);
if (missing.length) { console.error(`homescoop py-pynacl: python.wasm doesn't export ${missing.join(', ')}`); process.exit(1); }
if (fns.some((i) => /^(crypto_|sodium_|randombytes)/.test(i.name))) { console.error('homescoop py-pynacl: libsodium symbols left unresolved'); process.exit(1); }
console.log(`== py-pynacl: ${fns.length} function imports, all exported by python.wasm`);
JS

DI="$SITE/pynacl-$VERSION.dist-info"
mkdir -p "$DI/licenses"
cp "$SRC/PKG-INFO" "$DI/METADATA"
cp "$SRC/LICENSE" "$DI/licenses/LICENSE"
printf 'Wheel-Version: 1.0\nGenerator: homescoop (packages/py-pynacl/build.sh)\nRoot-Is-Purelib: false\nTag: cp315-cp315-wasix_wasm32\n\n' >"$DI/WHEEL"
printf 'nacl\n' >"$DI/top_level.txt"
"$HOSTPY" - "$SITE" "pynacl-$VERSION.dist-info" <<'PY'
import base64, hashlib, os, sys
site, di = sys.argv[1], sys.argv[2]
rows = []
for top in ("nacl", di):
    for d, _, files in sorted(os.walk(os.path.join(site, top))):
        for f in sorted(files):
            p = os.path.join(d, f)
            rel = os.path.relpath(p, site)
            if rel == f"{di}/RECORD" or "__pycache__" in rel:
                continue
            data = open(p, "rb").read()
            h = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode()
            rows.append(f"{rel},sha256={h},{len(data)}")
rows.append(f"{di}/RECORD,,")
open(os.path.join(site, di, "RECORD"), "w").write("\n".join(rows) + "\n")
PY
cp "$SRC/LICENSE" "$DEST/LICENSE"
WORK="$B" homescoop_notices_begin "nacl/_sodium links libsodium $SODIUM_VER statically (@ai-ecoverse/wasix-libsodium $(node -p "require('$SODIUM/package.json').version"), not the copy in PyNaCl's sdist). PyNaCl's own licence is LICENSE."
WORK="$B" homescoop_notice "libsodium $SODIUM_VER (ISC)" "$SODIUM/LICENSE" -
homescoop_compile_pyc "$SITE"
node "$ROOT/packages/py-kiwisolver/test/wasm-call-signatures.mjs" "$SO"
echo "== py-pynacl: staged $(du -sh "$DEST" | awk '{print $1}')"
