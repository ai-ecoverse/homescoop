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

HOST_PY="${WASIX_PYTHON_HOST_PY:-}"
if [[ -z "$HOST_PY" ]] && command -v python3.14 >/dev/null 2>&1; then
  HOST_PY="$(command -v python3.14)"
fi
if [[ -z "$HOST_PY" ]]; then
  HOST_PY="$WORK/host-python-3.14.2/bin/python3.14"
  if [[ ! -x "$HOST_PY" ]]; then
    echo "== stage-pure-wheel: host CPython 3.14.2 (compileall)"
    CPY_TGZ="$WORK/Python-3.14.2.tgz"
    homescoop_fetch "https://www.python.org/ftp/python/3.14.2/Python-3.14.2.tgz" \
      c609e078adab90e2c6bacb6afafacd5eaf60cd94cf670f1e159565725fcd448d "$CPY_TGZ"
    rm -rf "$WORK/host-python-src" && mkdir -p "$WORK/host-python-src"
    tar xzf "$CPY_TGZ" -C "$WORK/host-python-src" --strip-components=1
    (
      cd "$WORK/host-python-src"
      unset CC CXX CFLAGS CXXFLAGS LDFLAGS CPPFLAGS
      ./configure --prefix="$WORK/host-python-3.14.2" --without-ensurepip --disable-test-modules \
        py_cv_module__ssl=n/a py_cv_module__hashlib=n/a >"$WORK/host-python-configure.log" 2>&1
      make -j"${HOMESCOOP_JOBS:-4}" >"$WORK/host-python-make.log" 2>&1
      make install >"$WORK/host-python-install.log" 2>&1
    ) || { tail -40 "$WORK"/host-python-*.log >&2; exit 1; }
  fi
fi
"$HOST_PY" -c 'import sys; assert sys.version_info[:2] == (3, 14), sys.version'
export WASIX_PYTHON_HOST_PY="$HOST_PY"

WHL="$WORK/$(basename "$SRC_URL")"
homescoop_fetch "$SRC_URL" "$SRC_SHA" "$WHL"
SITE="$HOMESCOOP_PKG/package/lib/python3.14/site-packages"
rm -rf "$HOMESCOOP_PKG/package/lib"
mkdir -p "$SITE"
"$HOST_PY" -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$WHL" "$SITE"
find "$SITE" -type d -exec chmod 755 {} +
find "$SITE" -type f -exec chmod 644 {} +
echo "== stage-pure-wheel ($name): $(basename "$WHL") → lib/python3.14/site-packages ($("$HOST_PY" -V))"
homescoop_compile_pyc "$SITE"
