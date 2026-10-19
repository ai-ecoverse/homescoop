#!/usr/bin/env bash
set -euo pipefail
ROOT="${HOMESCOOP_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
export HOMESCOOP_ROOT="$ROOT"
# shellcheck source=./build-common.sh
source "$ROOT/scripts/build-common.sh"
name="${1:?usage: stage-pure-wheel.sh <recipe>}"
homescoop_load_recipe "$name"
case "$SRC_URL" in
  *-none-any.whl) ;;
  *) echo "stage-pure-wheel ($name): source.url is not a pure wheel (*-none-any.whl): $SRC_URL" >&2; exit 1 ;;
esac

# The python line comes from package.json's slicc.python.sitePackages
# (lib/python3.X/site-packages): 3.14 for the cp314 dirs, 3.15 for the
# <recipe>3.15 dirs of the Python 3.15 wave (homescoop#761).
PYMM="$(node -p "(/^lib\/python(3\.\d+)\/site-packages$/.exec(require('$HOMESCOOP_PKG/package/package.json').slicc.python.sitePackages) || [])[1] || ''")"
case "$PYMM" in
  3.14) CPY_VER=3.14.2 CPY_SHA=c609e078adab90e2c6bacb6afafacd5eaf60cd94cf670f1e159565725fcd448d ;;
  3.15) CPY_VER=3.15.0 CPY_SHA=438596cac081036d3c1d532ab7e7335eeb35567bc961749a0d5797176db0db68 ;;
  *) echo "stage-pure-wheel ($name): slicc.python.sitePackages must be lib/python3.14|3.15/site-packages (got '$PYMM')" >&2; exit 1 ;;
esac

HOST_PY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOST_PY" ]] && command -v "python$PYMM" >/dev/null 2>&1; then
  HOST_PY="$(command -v "python$PYMM")"
fi
if [[ -z "$HOST_PY" ]]; then
  HOST_PY="$WORK/host-python-$CPY_VER/bin/python$PYMM"
  if [[ ! -x "$HOST_PY" ]]; then
    echo "== stage-pure-wheel: host CPython $CPY_VER (compileall)"
    CPY_TGZ="$WORK/Python-$CPY_VER.tgz"
    homescoop_fetch "https://www.python.org/ftp/python/$CPY_VER/Python-$CPY_VER.tgz" "$CPY_SHA" "$CPY_TGZ"
    rm -rf "$WORK/host-python-src" && mkdir -p "$WORK/host-python-src"
    tar xzf "$CPY_TGZ" -C "$WORK/host-python-src" --strip-components=1
    (
      cd "$WORK/host-python-src"
      unset CC CXX CFLAGS CXXFLAGS LDFLAGS CPPFLAGS
      ./configure --prefix="$WORK/host-python-$CPY_VER" --without-ensurepip --disable-test-modules \
        py_cv_module__ssl=n/a py_cv_module__hashlib=n/a >"$WORK/host-python-configure.log" 2>&1
      make -j"${HOMESCOOP_JOBS:-4}" >"$WORK/host-python-make.log" 2>&1
      make install >"$WORK/host-python-install.log" 2>&1
    ) || { tail -40 "$WORK"/host-python-*.log >&2; exit 1; }
  fi
fi
"$HOST_PY" -c 'import sys; assert "%d.%d" % sys.version_info[:2] == sys.argv[1], sys.version' "$PYMM"
export WASIX_PYTHON_HOST_PY="$HOST_PY"

WHL="$WORK/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$WHL"
SITE="$HOMESCOOP_PKG/package/lib/python$PYMM/site-packages"
rm -rf "$HOMESCOOP_PKG/package/lib"
mkdir -p "$SITE"
"$HOST_PY" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$WHL" "$SITE"
find "$SITE" -type d -exec chmod 755 {} +
find "$SITE" -type f -exec chmod 644 {} +
echo "== stage-pure-wheel ($name): $(basename "$WHL") → lib/python$PYMM/site-packages ($("$HOST_PY" -V))"
homescoop_compile_pyc "$SITE"
